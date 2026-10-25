import sharp from 'sharp';
import type { AttachmentDTO, AttachmentKind, AiStatus } from '@catalogue/shared';
import { newId, nowIso, type DB } from '../../db';
import type { FileStore } from '../../storage/fileStore';

export interface AttachmentRow {
  id: string;
  item_id: string;
  kind: AttachmentKind;
  filename: string;
  mime: string;
  size: number;
  storage_key: string;
  wrapped_key: Buffer;
  thumb_storage_key: string | null;
  thumb_wrapped_key: Buffer | null;
  preview_storage_key: string | null;
  preview_wrapped_key: Buffer | null;
  extracted_text: string | null;
  ai_status: AiStatus;
  ai_error: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** 按文件头识别真实类型，不信任客户端声明 */
export function sniffMime(buf: Buffer): string | null {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('latin1');
    if (['heic', 'heix', 'mif1', 'msf1', 'heis'].includes(brand)) return 'image/heic';
  }
  return null;
}

export const isImage = (mime: string) => mime.startsWith('image/');

export function toAttachmentDTO(r: AttachmentRow): AttachmentDTO {
  return {
    id: r.id,
    itemId: r.item_id,
    kind: r.kind,
    filename: r.filename,
    mime: r.mime,
    size: r.size,
    hasThumbnail: !!r.thumb_storage_key,
    aiStatus: r.ai_status,
    aiError: r.ai_error,
    createdAt: r.created_at,
  };
}

export function getAttachment(db: DB, id: string): AttachmentRow | null {
  return (db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as AttachmentRow | undefined) ?? null;
}

export function listAttachments(db: DB, itemId: string): AttachmentDTO[] {
  const rows = db
    .prepare('SELECT * FROM attachments WHERE item_id = ? ORDER BY created_at')
    .all(itemId) as AttachmentRow[];
  return rows.map(toAttachmentDTO);
}

async function renderImage(buf: Buffer, size: number, quality: number): Promise<Buffer | null> {
  try {
    return await sharp(buf).rotate().resize(size, size, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality }).toBuffer();
  } catch {
    // 例如 HEIC 在预编译 sharp 中不可解码，此时只保存原件
    return null;
  }
}

export async function saveAttachment(
  db: DB,
  files: FileStore,
  input: { itemId: string; kind: AttachmentKind; filename: string; data: Buffer; mime: string; userId: string },
): Promise<AttachmentRow> {
  const original = files.put(input.data);
  let thumb: { storageKey: string; wrappedKey: Buffer } | null = null;
  let preview: { storageKey: string; wrappedKey: Buffer } | null = null;
  if (isImage(input.mime)) {
    const [t, p] = await Promise.all([renderImage(input.data, 480, 72), renderImage(input.data, 1600, 82)]);
    if (t) thumb = files.put(t);
    if (p) preview = files.put(p);
  }
  const row: AttachmentRow = {
    id: newId(),
    item_id: input.itemId,
    kind: input.kind,
    filename: input.filename.slice(0, 255),
    mime: input.mime,
    size: input.data.length,
    storage_key: original.storageKey,
    wrapped_key: original.wrappedKey,
    thumb_storage_key: thumb?.storageKey ?? null,
    thumb_wrapped_key: thumb?.wrappedKey ?? null,
    preview_storage_key: preview?.storageKey ?? null,
    preview_wrapped_key: preview?.wrappedKey ?? null,
    extracted_text: null,
    ai_status: 'pending',
    ai_error: null,
    uploaded_by: input.userId,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO attachments (id, item_id, kind, filename, mime, size, storage_key, wrapped_key,
       thumb_storage_key, thumb_wrapped_key, preview_storage_key, preview_wrapped_key,
       extracted_text, ai_status, ai_error, uploaded_by, created_at)
     VALUES (@id, @item_id, @kind, @filename, @mime, @size, @storage_key, @wrapped_key,
       @thumb_storage_key, @thumb_wrapped_key, @preview_storage_key, @preview_wrapped_key,
       @extracted_text, @ai_status, @ai_error, @uploaded_by, @created_at)`,
  ).run(row);
  return row;
}

export function removeAttachmentFiles(files: FileStore, a: AttachmentRow): void {
  for (const key of [a.storage_key, a.thumb_storage_key, a.preview_storage_key]) if (key) files.remove(key);
}

export function readOriginal(files: FileStore, a: AttachmentRow): Buffer {
  return files.get(a.storage_key, a.wrapped_key);
}

export function readVariant(files: FileStore, a: AttachmentRow, variant: 'thumb' | 'preview'): Buffer | null {
  const key = variant === 'thumb' ? a.thumb_storage_key : a.preview_storage_key;
  const wrapped = variant === 'thumb' ? a.thumb_wrapped_key : a.preview_wrapped_key;
  return key && wrapped ? files.get(key, wrapped) : null;
}
