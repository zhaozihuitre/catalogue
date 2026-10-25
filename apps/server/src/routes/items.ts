import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { FieldDef } from '@catalogue/shared';
import { audit, HttpError, notFound, requirePerm, userOf, vaultOf } from '../http/context';
import {
  createItem,
  diffItems,
  getCategory,
  getItem,
  itemInputSchema,
  listItems,
  toCategoryDTO,
  updateItem,
  type CategoryRow,
} from '../modules/items/items';
import { listAttachments, removeAttachmentFiles, type AttachmentRow } from '../modules/files/attachments';
import { enqueueJob } from '../modules/jobs/jobs';
import { newId, nowIso } from '../db';

const fieldSchema: z.ZodType<FieldDef> = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, '字段标识只能使用小写字母、数字、下划线'),
  label: z.string().trim().min(1).max(40),
  type: z.enum(['text', 'textarea', 'number', 'date', 'select']),
  options: z.array(z.string().trim().min(1)).optional(),
  required: z.boolean().optional(),
  private: z.boolean().optional(),
});

const categorySchema = z.object({
  name: z.string().trim().min(1).max(40),
  fields: z
    .array(fieldSchema)
    .max(60)
    .refine((fs) => new Set(fs.map((f) => f.key)).size === fs.length, '字段标识不能重复'),
});

const today = () => nowIso().slice(0, 10);

export async function itemRoutes(app: FastifyInstance) {
  /* ---------- 类目 ---------- */
  app.get('/api/categories', { preHandler: requirePerm('item.read') }, async (req) => {
    const rows = vaultOf(req).db.prepare('SELECT * FROM categories ORDER BY sort, created_at').all() as CategoryRow[];
    return rows.map(toCategoryDTO);
  });

  app.post('/api/categories', { preHandler: requirePerm('category.manage') }, async (req) => {
    const { db } = vaultOf(req);
    const body = categorySchema.parse(req.body);
    const id = newId();
    const sort = (db.prepare('SELECT coalesce(max(sort), 0) + 1 AS s FROM categories').get() as { s: number }).s;
    db.prepare(
      'INSERT INTO categories (id, code, name, fields, builtin, sort, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
    ).run(id, `custom${sort}`, body.name, JSON.stringify(body.fields), sort, nowIso());
    audit(req, 'category.create', id, { name: body.name });
    return getCategory(db, id);
  });

  app.put('/api/categories/:id', { preHandler: requirePerm('category.manage') }, async (req) => {
    const { db } = vaultOf(req);
    const { id } = req.params as { id: string };
    const body = categorySchema.parse(req.body);
    if (!getCategory(db, id)) throw notFound('分类');
    db.prepare('UPDATE categories SET name = ?, fields = ? WHERE id = ?').run(body.name, JSON.stringify(body.fields), id);
    audit(req, 'category.update', id, body);
    return getCategory(db, id);
  });

  app.delete('/api/categories/:id', { preHandler: requirePerm('category.manage') }, async (req) => {
    const { db } = vaultOf(req);
    const { id } = req.params as { id: string };
    const cat = getCategory(db, id);
    if (!cat) throw notFound('分类');
    if (cat.builtin) throw new HttpError(400, '预设分类不能删除');
    if (db.prepare('SELECT 1 FROM items WHERE category_id = ? LIMIT 1').get(id)) {
      throw new HttpError(400, '该分类下还有藏品，不能删除');
    }
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    audit(req, 'category.delete', id, { name: cat.name });
    return { ok: true };
  });

  /* ---------- 藏品 ---------- */
  app.get('/api/items', { preHandler: requirePerm('item.read') }, async (req) => {
    const q = z
      .object({
        q: z.string().trim().max(100).optional(),
        categoryId: z.string().optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
        sort: z.enum(['updated', 'name', 'purchaseDate', 'purchasePrice']).optional(),
      })
      .parse(req.query);
    return listItems(vaultOf(req).db, q);
  });

  app.get('/api/items/:id', { preHandler: requirePerm('item.read') }, async (req) => {
    const { db } = vaultOf(req);
    const { id } = req.params as { id: string };
    const item = getItem(db, id);
    if (!item) throw notFound('藏品');
    return { item, category: getCategory(db, item.categoryId), attachments: listAttachments(db, id) };
  });

  app.post('/api/items', { preHandler: requirePerm('item.create') }, async (req) => {
    const { db } = vaultOf(req);
    const item = createItem(db, itemInputSchema.parse(req.body), userOf(req).id);
    enqueueJob(db, 'index_item', { itemId: item.id });
    audit(req, 'item.create', item.id, { code: item.code, name: item.name });
    return item;
  });

  app.put('/api/items/:id', { preHandler: requirePerm('item.update') }, async (req) => {
    const { db } = vaultOf(req);
    const { id } = req.params as { id: string };
    const before = getItem(db, id);
    if (!before) throw notFound('藏品');
    const after = updateItem(db, id, itemInputSchema.parse(req.body));
    enqueueJob(db, 'index_item', { itemId: id });
    audit(req, 'item.update', id, { code: after.code, changes: diffItems(before, after) });
    return after;
  });

  app.delete('/api/items/:id', { preHandler: requirePerm('item.delete') }, async (req) => {
    const { db, files } = vaultOf(req);
    const { id } = req.params as { id: string };
    const item = getItem(db, id);
    if (!item) throw notFound('藏品');
    const atts = db.prepare('SELECT * FROM attachments WHERE item_id = ?').all(id) as AttachmentRow[];
    db.prepare('DELETE FROM items WHERE id = ?').run(id);
    atts.forEach((a) => removeAttachmentFiles(files, a));
    audit(req, 'item.delete', id, { code: item.code, name: item.name, attachments: atts.length });
    return { ok: true };
  });

  /** 一键记录盘点 / 保养 */
  for (const [path, column, action] of [
    ['inventory', 'last_inventory_date', 'item.inventory'],
    ['maintenance', 'last_maintenance_date', 'item.maintenance'],
  ] as const) {
    app.post(`/api/items/:id/${path}`, { preHandler: requirePerm('item.update') }, async (req) => {
      const { db } = vaultOf(req);
      const { id } = req.params as { id: string };
      const { date } = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.body ?? {});
      if (!getItem(db, id)) throw notFound('藏品');
      db.prepare(`UPDATE items SET ${column} = ?, updated_at = ? WHERE id = ?`).run(date ?? today(), nowIso(), id);
      enqueueJob(db, 'index_item', { itemId: id });
      audit(req, action, id, { date: date ?? today() });
      return getItem(db, id);
    });
  }
}
