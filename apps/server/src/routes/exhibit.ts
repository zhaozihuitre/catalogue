import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, HttpError, notFound, requirePerm, userOf, vaultOf } from '../http/context';
import { buildPlaylist, getExhibition, listExhibitions } from '../modules/exhibit/exhibit';
import { newId, nowIso } from '../db';
import { getAttachment, readVariant } from '../modules/files/attachments';

const exhibitionSchema = z.object({
  name: z.string().trim().min(1, '请填写展览名称').max(60),
  description: z.string().trim().max(500).nullable().optional(),
  itemIds: z.array(z.string()).max(500),
  intervalSec: z.number().int().min(3).max(120).default(10),
});

export async function exhibitRoutes(app: FastifyInstance) {
  const view = { preHandler: requirePerm('exhibit.view') };
  const manage = { preHandler: requirePerm('exhibit.manage') };

  app.get('/api/exhibitions', view, async (req) => listExhibitions(vaultOf(req).db));

  app.post('/api/exhibitions', manage, async (req) => {
    const { db } = vaultOf(req);
    const body = exhibitionSchema.parse(req.body);
    const id = newId();
    const now = nowIso();
    db.prepare(
      `INSERT INTO exhibitions (id, name, description, item_ids, interval_sec, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, body.name, body.description ?? null, JSON.stringify(body.itemIds), body.intervalSec, userOf(req).id, now, now);
    audit(req, 'exhibit.create', id, { name: body.name, items: body.itemIds.length });
    return getExhibition(db, id);
  });

  app.put('/api/exhibitions/:id', manage, async (req) => {
    const { db } = vaultOf(req);
    const { id } = req.params as { id: string };
    if (!getExhibition(db, id)) throw notFound('展览');
    const body = exhibitionSchema.parse(req.body);
    db.prepare(
      'UPDATE exhibitions SET name = ?, description = ?, item_ids = ?, interval_sec = ?, updated_at = ? WHERE id = ?',
    ).run(body.name, body.description ?? null, JSON.stringify(body.itemIds), body.intervalSec, nowIso(), id);
    audit(req, 'exhibit.update', id, { name: body.name, items: body.itemIds.length });
    return getExhibition(db, id);
  });

  app.delete('/api/exhibitions/:id', manage, async (req) => {
    const { db } = vaultOf(req);
    const { id } = req.params as { id: string };
    const ex = getExhibition(db, id);
    if (!ex) throw notFound('展览');
    db.prepare('DELETE FROM exhibitions WHERE id = ?').run(id);
    audit(req, 'exhibit.delete', id, { name: ex.name });
    return { ok: true };
  });

  /** 放映用图片：只提供压缩预览图（不提供原件）；放映行为已在获取列表时记审计，这里不逐张记录 */
  app.get('/api/exhibit/image/:id', view, async (req, reply) => {
    const { db, files } = vaultOf(req);
    const a = getAttachment(db, (req.params as { id: string }).id);
    const buf = a ? readVariant(files, a, 'preview') : null;
    if (!buf) throw notFound('图片');
    reply.header('Cache-Control', 'private, no-store, max-age=0');
    return reply.type('image/jpeg').send(buf);
  });

  /** 放映列表：?exhibitionId= 按展览，?categoryId= 按分类，都不传则为全部藏品 */
  app.get('/api/exhibit/playlist', view, async (req) => {
    const { db } = vaultOf(req);
    const q = z.object({ exhibitionId: z.string().optional(), categoryId: z.string().optional() }).parse(req.query);
    let exhibition;
    if (q.exhibitionId) {
      exhibition = getExhibition(db, q.exhibitionId) ?? undefined;
      if (!exhibition) throw notFound('展览');
    }
    const playlist = buildPlaylist(db, { exhibition, categoryId: q.categoryId });
    if (!playlist.slides.length && !playlist.skipped) throw new HttpError(404, '没有可放映的藏品');
    audit(req, 'exhibit.play', q.exhibitionId ?? q.categoryId ?? 'all', {
      title: playlist.title,
      device: String(req.headers['user-agent'] ?? '').slice(0, 120),
    });
    return playlist;
  });
}
