import ExcelJS from 'exceljs';
import type { CategoryDTO, ItemDTO } from '@catalogue/shared';
import type { DB } from '../../db';
import { ITEM_SELECT, rowToItem, toCategoryDTO, type CategoryRow } from '../items/items';
import { daysBetween, localToday } from '../reminders/reminders';

function load(db: DB) {
  const items = (db.prepare(`${ITEM_SELECT} ORDER BY i.code`).all() as Record<string, unknown>[]).map(rowToItem);
  const cats = (db.prepare('SELECT * FROM categories ORDER BY sort').all() as CategoryRow[]).map(toCategoryDTO);
  return { items, cats, catById: new Map(cats.map((c) => [c.id, c])) };
}

function newBook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Catalogue 藏册';
  wb.created = new Date();
  return wb;
}

function styleHeader(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3A3127' } };
  row.alignment = { vertical: 'middle' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
}

const MONEY = '#,##0.00';

const BASE_COLUMNS: { header: string; key: keyof ItemDTO | 'category'; width: number; money?: boolean }[] = [
  { header: '藏品编号', key: 'code', width: 14 },
  { header: '藏品名称', key: 'name', width: 28 },
  { header: '分类', key: 'category', width: 12 },
  { header: '购入时间', key: 'purchaseDate', width: 12 },
  { header: '购入渠道', key: 'purchaseChannel', width: 18 },
  { header: '购入价(元)', key: 'purchasePrice', width: 14, money: true },
  { header: '参考市价(元)', key: 'marketPrice', width: 14, money: true },
  { header: '存放位置', key: 'location', width: 16 },
  { header: '保险公司', key: 'insuranceCompany', width: 16 },
  { header: '保单号', key: 'insurancePolicyNo', width: 18 },
  { header: '保额(元)', key: 'insuranceAmount', width: 14, money: true },
  { header: '保险到期', key: 'insuranceExpiry', width: 12 },
  { header: '保养周期(天)', key: 'maintenanceCycleDays', width: 12 },
  { header: '上次保养', key: 'lastMaintenanceDate', width: 12 },
  { header: '上次盘点', key: 'lastInventoryDate', width: 12 },
  { header: '备注', key: 'notes', width: 30 },
];

/** 全量藏品台账：基础字段一张总表，每个分类的专属字段各一张分表 */
export async function buildLedger(db: DB): Promise<Buffer> {
  const { items, cats, catById } = load(db);
  const wb = newBook();
  const ws = wb.addWorksheet('藏品台账');
  ws.columns = BASE_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width, style: c.money ? { numFmt: MONEY } : {} }));
  for (const it of items) ws.addRow({ ...it, category: catById.get(it.categoryId)?.name ?? '' });
  styleHeader(ws);

  for (const cat of cats) {
    const rows = items.filter((i) => i.categoryId === cat.id);
    if (!rows.length) continue;
    const sheet = wb.addWorksheet(cat.name.slice(0, 31));
    sheet.columns = [
      { header: '藏品编号', key: '__code', width: 14 },
      { header: '藏品名称', key: '__name', width: 28 },
      ...cat.fields.map((f) => ({ header: f.label, key: f.key, width: Math.max(12, f.label.length * 2 + 4) })),
    ];
    for (const it of rows) sheet.addRow({ __code: it.code, __name: it.name, ...it.attributes });
    styleHeader(sheet);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function buildInsuranceList(db: DB): Promise<Buffer> {
  const { items, catById } = load(db);
  const today = localToday();
  const wb = newBook();
  const ws = wb.addWorksheet('保险清单');
  ws.columns = [
    { header: '藏品编号', key: 'code', width: 14 },
    { header: '藏品名称', key: 'name', width: 28 },
    { header: '分类', key: 'category', width: 12 },
    { header: '保险公司', key: 'insuranceCompany', width: 18 },
    { header: '保单号', key: 'insurancePolicyNo', width: 20 },
    { header: '保额(元)', key: 'insuranceAmount', width: 14, style: { numFmt: MONEY } },
    { header: '到期日', key: 'insuranceExpiry', width: 12 },
    { header: '剩余天数', key: 'left', width: 10 },
    { header: '状态', key: 'status', width: 10 },
  ];
  const rows = items
    .map((it) => {
      const left = it.insuranceExpiry ? daysBetween(today, it.insuranceExpiry) : null;
      const status = !it.insuranceExpiry ? '未投保' : left! < 0 ? '已过期' : left! <= 30 ? '即将到期' : '有效';
      return { ...it, category: catById.get(it.categoryId)?.name ?? '', left, status };
    })
    .sort((a, b) => (a.left ?? Infinity) - (b.left ?? Infinity));
  for (const r of rows) {
    const row = ws.addRow(r);
    if (r.status === '已过期' || r.status === '即将到期') row.getCell('status').font = { color: { argb: 'FFC0392B' }, bold: true };
  }
  styleHeader(ws);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function buildStats(db: DB): Promise<Buffer> {
  const { items, cats } = load(db);
  const wb = newBook();
  const ws = wb.addWorksheet('分类统计');
  ws.columns = [
    { header: '分类', key: 'name', width: 14 },
    { header: '藏品数量', key: 'count', width: 10 },
    { header: '购入价合计(元)', key: 'purchase', width: 18, style: { numFmt: MONEY } },
    { header: '参考市价合计(元)', key: 'market', width: 18, style: { numFmt: MONEY } },
    { header: '保额合计(元)', key: 'insured', width: 18, style: { numFmt: MONEY } },
    { header: '已投保数量', key: 'insuredCount', width: 12 },
  ];
  const sum = (xs: (number | null)[]) => xs.reduce<number>((s, x) => s + (x ?? 0), 0);
  const statRow = (name: string, list: ItemDTO[]) => ({
    name,
    count: list.length,
    purchase: sum(list.map((i) => i.purchasePrice)),
    market: sum(list.map((i) => i.marketPrice)),
    insured: sum(list.map((i) => i.insuranceAmount)),
    insuredCount: list.filter((i) => i.insuranceExpiry).length,
  });
  for (const c of cats as CategoryDTO[]) ws.addRow(statRow(c.name, items.filter((i) => i.categoryId === c.id)));
  const total = ws.addRow(statRow('合计', items));
  total.font = { bold: true };
  styleHeader(ws);
  ws.addRow([]);
  ws.addRow(['注：参考市价为藏家自行填写的数据，系统不提供估值。']).font = { italic: true, color: { argb: 'FF888888' } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
