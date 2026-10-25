import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ATTACHMENT_KINDS, CORE_ATTACHMENT_KINDS, type AttachmentKind } from '@catalogue/shared';
import { assertCan, audit, HttpError, notFound, requirePerm, userOf, vaultOf } from '../http/context';
import {
  getAttachment,
  MAX_UPLOAD_BYTES,
  readOriginal,
  readVariant,
  removeAttachmentFiles,
  saveAttachment,
  sniffMime,
  toAttachmentDTO,
} from '../modules/files/attachments';
import { getItem } from '../modules/items/items';
import { enqueueJob } from '../modules/jobs/jobs';
import { getSummary } from '../ai/summaries';

const kindSchema = z.enum(Object.keys(ATTACHMENT_KINDS) as [AttachmentKind, ...AttachmentKind[]]);

/** 档案文件一律禁止缓存，避免在浏览器或手机上留存 */
function noStore(reply: FastifyReply) {
  reply.header('Cache-Control', 'private, no-store, max-age=0');
}

function contentDisposition(type: 'inline' | 'attachment', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function attachmentRoutes(app: FastifyInstance) {
  app.post('/api/items/:id/attachments', { preHandler: requirePerm('file.upload') }, async (req) => {
    const { db, files } = vaultOf(req);
    const user = userOf(req);
    const { id } = req.params as { id: string };
    const { kind } = z.object({ kind: kindSchema.default('photo') }).parse(req.query);
    if (!getItem(db, id)) throw notFound('藏品');

    const saved = [];
    for await (const part of req.files({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 30 } })) {
      const data = await part.toBuffer();
      const mime = sniffMime(data);
      if (!mime) throw new HttpError(415, `不支持的文件类型：${part.filename}（仅支持 JPG/PNG/WEBP/HEIC 图片和 PDF）`);
      const row = await saveAttachment(db, files, {
        itemId: id,
        kind,
        filename: part.filename || 'unnamed',
        data,
        mime,
        userId: user.id,
      });
      enqueueJob(db, 'process_attachment', { attachmentId: row.id });
      audit(req, 'file.upload', row.id, { itemId: id, kind, filename: row.filename, size: row.size, mime });
      saved.push(toAttachmentDTO(row));
    }
    if (!saved.length) throw new HttpError(400, '没有收到文件');
    return saved;
  });

  app.get('/api/attachments/:id/thumb', { preHandler: requirePerm('file.preview') }, async (req, reply) => {
    const { db, files } = vaultOf(req);
    const a = getAttachment(db, (req.params as { id: string }).id);
    if (!a) throw notFound('文件');
    const buf = readVariant(files, a, 'thumb');
    if (!buf) throw notFound('缩略图');
    noStore(reply);
    return reply.type('image/jpeg').send(buf);
  });

  /** 图片大图预览（只读访客可用）。原件下载需要 file.download 权限 */
  app.get('/api/attachments/:id/preview', { preHandler: requirePerm('file.preview') }, async (req, reply) => {
    const { db, files } = vaultOf(req);
    const a = getAttachment(db, (req.params as { id: string }).id);
    if (!a) throw notFound('文件');
    const buf = readVariant(files, a, 'preview');
    if (!buf) throw notFound('预览图');
    audit(req, 'file.preview', a.id, { itemId: a.item_id });
    noStore(reply);
    return reply.type('image/jpeg').send(buf);
  });

  /** 文档识别文本与 AI 摘要（只读访客查看 PDF 的方式） */
  app.get('/api/attachments/:id/text', { preHandler: requirePerm('file.preview') }, async (req) => {
    const { db } = vaultOf(req);
    const a = getAttachment(db, (req.params as { id: string }).id);
    if (!a) throw notFound('文件');
    audit(req, 'file.viewText', a.id, { itemId: a.item_id });
    return { attachment: toAttachmentDTO(a), text: a.extracted_text, summary: getSummary(db, a.id) };
  });

  app.get('/api/attachments/:id/download', { preHandler: requirePerm('file.download') }, async (req, reply) => {
    const { db, files } = vaultOf(req);
    const a = getAttachment(db, (req.params as { id: string }).id);
    if (!a) throw notFound('文件');
    const inline = (req.query as { inline?: string }).inline === '1';
    const buf = readOriginal(files, a);
    audit(req, inline ? 'file.open' : 'file.download', a.id, { itemId: a.item_id, filename: a.filename });
    noStore(reply);
    reply.header('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', a.filename));
    return reply.type(a.mime).send(buf);
  });

  app.patch('/api/attachments/:id', { preHandler: requirePerm('file.upload') }, async (req) => {
    const { db } = vaultOf(req);
    const a = getAttachment(db, (req.params as { id: string }).id);
    if (!a) throw notFound('文件');
    const { kind } = z.object({ kind: kindSchema }).parse(req.body);
    // 把核心档案改成普通类型等同于绕开删除限制，因此同样需要藏家权限
    if (CORE_ATTACHMENT_KINDS.includes(a.kind) && !CORE_ATTACHMENT_KINDS.includes(kind)) assertCan(req, 'file.deleteCore');
    db.prepare('UPDATE attachments SET kind = ? WHERE id = ?').run(kind, a.id);
    audit(req, 'file.updateKind', a.id, { from: a.kind, to: kind });
    return toAttachmentDTO(getAttachment(db, a.id)!);
  });

  app.delete('/api/attachments/:id', { preHandler: requirePerm('file.delete') }, async (req) => {
    const { db, files } = vaultOf(req);
    const a = getAttachment(db, (req.params as { id: string }).id);
    if (!a) throw notFound('文件');
    if (CORE_ATTACHMENT_KINDS.includes(a.kind)) assertCan(req, 'file.deleteCore');
    db.prepare('DELETE FROM attachments WHERE id = ?').run(a.id);
    removeAttachmentFiles(files, a);
    enqueueJob(db, 'index_item', { itemId: a.item_id });
    audit(req, 'file.delete', a.id, { itemId: a.item_id, kind: a.kind, filename: a.filename });
    return { ok: true };
  });

  app.post('/api/attachments/:id/reprocess', { preHandler: requirePerm('ai.reprocess') }, async (req) => {
    const { db } = vaultOf(req);
    const a = getAttachment(db, (req.params as { id: string }).id);
    if (!a) throw notFound('文件');
    db.prepare(`UPDATE attachments SET ai_status = 'pending', ai_error = NULL WHERE id = ?`).run(a.id);
    enqueueJob(db, 'process_attachment', { attachmentId: a.id });
    audit(req, 'ai.reprocess', a.id);
    return { ok: true };
  });
}
