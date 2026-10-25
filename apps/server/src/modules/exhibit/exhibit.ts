import type { CategoryDTO, ExhibitionDTO, ExhibitPlaylist, ExhibitSlide, ItemDTO } from '@catalogue/shared';
import type { DB } from '../../db';
import { ITEM_SELECT, rowToItem, toCategoryDTO, type CategoryRow } from '../items/items';

interface ExhibitionRow {
  id: string;
  name: string;
  description: string | null;
  item_ids: string;
  interval_sec: number;
  created_at: string;
  updated_at: string;
}

export function toExhibitionDTO(r: ExhibitionRow): ExhibitionDTO {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    itemIds: JSON.parse(r.item_ids),
    intervalSec: r.interval_sec,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function getExhibition(db: DB, id: string): ExhibitionDTO | null {
  const r = db.prepare('SELECT * FROM exhibitions WHERE id = ?').get(id) as ExhibitionRow | undefined;
  return r ? toExhibitionDTO(r) : null;
}

export function listExhibitions(db: DB): ExhibitionDTO[] {
  return (db.prepare('SELECT * FROM exhibitions ORDER BY updated_at DESC').all() as ExhibitionRow[]).map(toExhibitionDTO);
}

/**
 * 白名单方式构造展品说明：只放类目专属字段中未标记为敏感的项。
 * 价格、存放位置、保险、备注、藏品编号等基础字段一律不输出。
 */
export function toSlide(item: ItemDTO, cat: CategoryDTO | undefined, imageIds: string[]): ExhibitSlide {
  const fields = (cat?.fields ?? [])
    .filter((f) => !f.private)
    .map((f) => ({ label: f.label, value: item.attributes[f.key] }))
    .filter((f) => f.value !== undefined && f.value !== null && f.value !== '')
    .map((f) => ({ label: f.label, value: String(f.value) }));
  return { itemId: item.id, name: item.name, categoryName: cat?.name ?? '', fields, imageIds };
}

/** 按展览、分类或全部藏品生成放映列表；没有图片的藏品不参与放映 */
export function buildPlaylist(
  db: DB,
  source: { exhibition?: ExhibitionDTO; categoryId?: string },
): ExhibitPlaylist {
  const cats = new Map(
    (db.prepare('SELECT * FROM categories').all() as CategoryRow[]).map((r) => [r.id, toCategoryDTO(r)]),
  );

  let items: ItemDTO[];
  if (source.exhibition) {
    const ids = source.exhibition.itemIds;
    const found = ids.length
      ? (db
          .prepare(`${ITEM_SELECT} WHERE i.id IN (${ids.map(() => '?').join(',')})`)
          .all(...ids) as Record<string, unknown>[]).map(rowToItem)
      : [];
    const byId = new Map(found.map((i) => [i.id, i]));
    items = ids.map((id) => byId.get(id)).filter((i): i is ItemDTO => !!i);
  } else {
    const rows = source.categoryId
      ? db.prepare(`${ITEM_SELECT} WHERE i.category_id = ? ORDER BY i.code`).all(source.categoryId)
      : db.prepare(`${ITEM_SELECT} ORDER BY i.category_id, i.code`).all();
    items = (rows as Record<string, unknown>[]).map(rowToItem);
  }

  // 实拍图优先，其次细节图，再其次其他有预览图的图片
  const imagesStmt = db.prepare(
    `SELECT id FROM attachments WHERE item_id = ? AND preview_storage_key IS NOT NULL
     ORDER BY CASE kind WHEN 'photo' THEN 0 WHEN 'detail' THEN 1 ELSE 2 END, created_at`,
  );
  const slides: ExhibitSlide[] = [];
  let skipped = 0;
  for (const item of items) {
    const imageIds = (imagesStmt.all(item.id) as { id: string }[]).map((r) => r.id);
    if (!imageIds.length) {
      skipped++;
      continue;
    }
    slides.push(toSlide(item, cats.get(item.categoryId), imageIds));
  }

  const title = source.exhibition?.name ?? (source.categoryId ? (cats.get(source.categoryId)?.name ?? '藏品') : '全部藏品');
  return {
    title,
    description: source.exhibition?.description ?? null,
    intervalSec: source.exhibition?.intervalSec ?? 10,
    slides,
    skipped,
  };
}
