import { z } from 'zod';
import type { CategoryDTO, FieldDef, ItemDTO } from '@catalogue/shared';
import { newId, nowIso, type DB } from '../../db';
import { HttpError } from '../../http/context';

export interface CategoryRow {
  id: string;
  code: string;
  name: string;
  fields: string;
  builtin: number;
  sort: number;
}

export function toCategoryDTO(r: CategoryRow): CategoryDTO {
  return { id: r.id, code: r.code, name: r.name, fields: JSON.parse(r.fields), builtin: !!r.builtin };
}

export function getCategory(db: DB, id: string): CategoryDTO | null {
  const r = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as CategoryRow | undefined;
  return r ? toCategoryDTO(r) : null;
}

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
  .nullable()
  .optional();
const money = z.number().nonnegative().nullable().optional();
const text = (max: number) => z.string().trim().max(max).nullable().optional();

export const itemInputSchema = z.object({
  code: text(40),
  name: z.string().trim().min(1, '藏品名称不能为空').max(200),
  categoryId: z.string().min(1),
  purchaseDate: dateStr,
  purchaseChannel: text(200),
  purchasePrice: money,
  marketPrice: money,
  location: text(200),
  insuranceCompany: text(200),
  insurancePolicyNo: text(100),
  insuranceAmount: money,
  insuranceExpiry: dateStr,
  maintenanceCycleDays: z.number().int().positive().nullable().optional(),
  lastMaintenanceDate: dateStr,
  lastInventoryDate: dateStr,
  notes: text(5000),
  attributes: z.record(z.string(), z.unknown()).optional(),
});

export type ItemInput = z.infer<typeof itemInputSchema>;

/** 按类目字段定义清洗自定义属性：丢弃未定义字段，按类型校验 */
export function sanitizeAttributes(fields: FieldDef[], attrs: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = attrs[f.key];
    if (v === undefined || v === null || v === '') {
      if (f.required) throw new HttpError(400, `请填写「${f.label}」`);
      continue;
    }
    switch (f.type) {
      case 'number': {
        const n = typeof v === 'number' ? v : Number(v);
        if (!Number.isFinite(n)) throw new HttpError(400, `「${f.label}」应为数字`);
        out[f.key] = n;
        break;
      }
      case 'date':
        if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new HttpError(400, `「${f.label}」日期格式错误`);
        out[f.key] = v;
        break;
      case 'select':
        if (f.options && !f.options.includes(String(v))) throw new HttpError(400, `「${f.label}」取值不在可选范围内`);
        out[f.key] = String(v);
        break;
      default:
        out[f.key] = String(v).slice(0, 5000);
    }
  }
  return out;
}

const COLUMNS: [keyof ItemDTO, string][] = [
  ['code', 'code'],
  ['name', 'name'],
  ['categoryId', 'category_id'],
  ['purchaseDate', 'purchase_date'],
  ['purchaseChannel', 'purchase_channel'],
  ['purchasePrice', 'purchase_price'],
  ['marketPrice', 'market_price'],
  ['location', 'location'],
  ['insuranceCompany', 'insurance_company'],
  ['insurancePolicyNo', 'insurance_policy_no'],
  ['insuranceAmount', 'insurance_amount'],
  ['insuranceExpiry', 'insurance_expiry'],
  ['maintenanceCycleDays', 'maintenance_cycle_days'],
  ['lastMaintenanceDate', 'last_maintenance_date'],
  ['lastInventoryDate', 'last_inventory_date'],
  ['notes', 'notes'],
];

export const ITEM_SELECT = `
  SELECT i.id, ${COLUMNS.map(([k, c]) => `i.${c} AS ${k}`).join(', ')},
    i.attributes, i.created_at AS createdAt, i.updated_at AS updatedAt,
    (SELECT a.id FROM attachments a WHERE a.item_id = i.id AND a.thumb_storage_key IS NOT NULL
      ORDER BY CASE a.kind WHEN 'photo' THEN 0 ELSE 1 END, a.created_at LIMIT 1) AS coverAttachmentId
  FROM items i`;

export function rowToItem(r: Record<string, unknown>): ItemDTO {
  return { ...(r as unknown as ItemDTO), attributes: JSON.parse(String(r.attributes ?? '{}')) };
}

export function getItem(db: DB, id: string): ItemDTO | null {
  const r = db.prepare(`${ITEM_SELECT} WHERE i.id = ?`).get(id) as Record<string, unknown> | undefined;
  return r ? rowToItem(r) : null;
}

function nextCode(db: DB, categoryCode: string): string {
  const prefix = `${categoryCode.slice(0, 3).toUpperCase()}-`;
  const last = db
    .prepare(`SELECT code FROM items WHERE code LIKE ? ORDER BY code DESC LIMIT 1`)
    .get(`${prefix}%`) as { code: string } | undefined;
  const n = last ? Number(last.code.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(Number.isFinite(n) ? n : 1).padStart(5, '0')}`;
}

function normalize(db: DB, input: ItemInput) {
  const cat = getCategory(db, input.categoryId);
  if (!cat) throw new HttpError(400, '分类不存在');
  return { cat, attributes: sanitizeAttributes(cat.fields, input.attributes) };
}

export function createItem(db: DB, input: ItemInput, userId: string): ItemDTO {
  const { cat, attributes } = normalize(db, input);
  const id = newId();
  const now = nowIso();
  const code = input.code?.trim() || nextCode(db, cat.code);
  if (db.prepare('SELECT 1 FROM items WHERE code = ?').get(code)) throw new HttpError(409, `藏品编号 ${code} 已存在`);
  const values = COLUMNS.map(([k]) => (k === 'code' ? code : ((input as Record<string, unknown>)[k] ?? null)));
  db.prepare(
    `INSERT INTO items (id, ${COLUMNS.map(([, c]) => c).join(', ')}, attributes, created_by, created_at, updated_at)
     VALUES (?, ${COLUMNS.map(() => '?').join(', ')}, ?, ?, ?, ?)`,
  ).run(id, ...values, JSON.stringify(attributes), userId, now, now);
  return getItem(db, id)!;
}

export function updateItem(db: DB, id: string, input: ItemInput): ItemDTO {
  const existing = getItem(db, id);
  if (!existing) throw new HttpError(404, '藏品不存在');
  const { attributes } = normalize(db, input);
  const code = input.code?.trim() || existing.code;
  if (code !== existing.code && db.prepare('SELECT 1 FROM items WHERE code = ?').get(code)) {
    throw new HttpError(409, `藏品编号 ${code} 已存在`);
  }
  const values = COLUMNS.map(([k]) => (k === 'code' ? code : ((input as Record<string, unknown>)[k] ?? null)));
  db.prepare(
    `UPDATE items SET ${COLUMNS.map(([, c]) => `${c} = ?`).join(', ')}, attributes = ?, updated_at = ? WHERE id = ?`,
  ).run(...values, JSON.stringify(attributes), nowIso(), id);
  return getItem(db, id)!;
}

/** 返回字段级变更，写入审计日志 */
export function diffItems(before: ItemDTO, after: ItemDTO): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const [k] of COLUMNS) if (before[k] !== after[k]) out[k] = [before[k], after[k]];
  const a = JSON.stringify(before.attributes);
  const b = JSON.stringify(after.attributes);
  if (a !== b) out.attributes = [before.attributes, after.attributes];
  return out;
}

export interface ItemQuery {
  q?: string;
  categoryId?: string;
  page: number;
  pageSize: number;
  sort?: 'updated' | 'name' | 'purchaseDate' | 'purchasePrice';
}

export function listItems(db: DB, q: ItemQuery): { total: number; rows: ItemDTO[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.categoryId) (where.push('i.category_id = ?'), params.push(q.categoryId));
  if (q.q) {
    const like = `%${q.q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    where.push(`(i.name LIKE ? ESCAPE '\\' OR i.code LIKE ? ESCAPE '\\' OR i.location LIKE ? ESCAPE '\\'
      OR i.notes LIKE ? ESCAPE '\\' OR i.attributes LIKE ? ESCAPE '\\')`);
    params.push(like, like, like, like, like);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order = {
    updated: 'i.updated_at DESC',
    name: 'i.name COLLATE NOCASE',
    purchaseDate: 'i.purchase_date DESC',
    purchasePrice: 'i.purchase_price DESC',
  }[q.sort ?? 'updated'];
  const total = (db.prepare(`SELECT count(*) AS n FROM items i ${w}`).get(...params) as { n: number }).n;
  const rows = db
    .prepare(`${ITEM_SELECT} ${w} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, q.pageSize, (q.page - 1) * q.pageSize) as Record<string, unknown>[];
  return { total, rows: rows.map(rowToItem) };
}

/** 藏品"档案卡"文本，供检索使用 */
export function itemCardText(item: ItemDTO, cat: CategoryDTO | null): string {
  const lines = [
    `藏品名称：${item.name}`,
    `藏品编号：${item.code}`,
    `分类：${cat?.name ?? ''}`,
  ];
  const add = (label: string, v: unknown) => {
    if (v !== null && v !== undefined && v !== '') lines.push(`${label}：${v}`);
  };
  add('购入时间', item.purchaseDate);
  add('购入渠道', item.purchaseChannel);
  add('购入价（元）', item.purchasePrice);
  add('参考市价（元，藏家自填）', item.marketPrice);
  add('存放位置', item.location);
  add('保险公司', item.insuranceCompany);
  add('保单号', item.insurancePolicyNo);
  add('保额（元）', item.insuranceAmount);
  add('保险到期日', item.insuranceExpiry);
  add('保养周期（天）', item.maintenanceCycleDays);
  add('上次保养日期', item.lastMaintenanceDate);
  add('上次盘点日期', item.lastInventoryDate);
  for (const f of cat?.fields ?? []) add(f.label, item.attributes[f.key]);
  add('备注', item.notes);
  return lines.join('\n');
}
