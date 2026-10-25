import type { DB } from '../db';
import { dot, fromBlob, type Embedder } from './embedder';

export interface Hit {
  chunkId: number;
  itemId: string;
  itemName: string;
  attachmentId: string | null;
  filename: string | null;
  text: string;
  score: number;
}

interface ChunkRow {
  id: number;
  item_id: string;
  item_name: string;
  attachment_id: string | null;
  filename: string | null;
  text: string;
  embedding: Buffer | null;
  embed_model: string | null;
}

const STOP_WORDS =
  /请问|帮我|帮忙|查一下|查查|看看|告诉我|一下|我的|我们的|我家|这件|那件|哪里|哪儿|在哪|什么|多少|几个|哪些|哪个|有没有|是否|是不是|吗|呢|吧|了|的|呀|啊|？|\?|，|,|。/g;

/** 关键词粒度：中文按二元组，英文/数字按整词 */
export function grams(s: string): Set<string> {
  const out = new Set<string>();
  const lower = s.toLowerCase();
  for (const w of lower.match(/[a-z0-9][a-z0-9.\-/]+/g) ?? []) out.add(w);
  for (const run of lower.match(/[一-鿿]+/g) ?? []) {
    if (run.length === 1) out.add(run);
    for (let i = 0; i + 1 < run.length; i++) out.add(run.slice(i, i + 2));
  }
  return out;
}

export function keywordScore(query: string, text: string): number {
  const q = grams(query.replace(STOP_WORDS, ' '));
  if (!q.size) return 0;
  const t = text.toLowerCase();
  let hit = 0;
  for (const g of q) if (t.includes(g)) hit++;
  return hit / q.size;
}

export interface RetrieveOptions {
  itemId?: string;
  topK: number;
  minVectorScore: number;
  minKeywordScore: number;
}

/**
 * 在加密 SQLite 中检索档案片段。有 embedding 模型时走向量检索，否则退化为关键词检索。
 * 私人藏品规模（万级片段以内）全量扫描足够快，且向量与原文一样受整库加密保护。
 */
export async function retrieve(
  db: DB,
  embedder: Embedder | null,
  query: string,
  opts: RetrieveOptions,
): Promise<{ hits: Hit[]; mode: 'vector' | 'keyword' }> {
  const rows = db
    .prepare(
      `SELECT c.id, c.item_id, i.name AS item_name, c.attachment_id, a.filename, c.text, c.embedding, c.embed_model
       FROM doc_chunks c JOIN items i ON i.id = c.item_id LEFT JOIN attachments a ON a.id = c.attachment_id
       ${opts.itemId ? 'WHERE c.item_id = ?' : ''}`,
    )
    .all(...(opts.itemId ? [opts.itemId] : [])) as ChunkRow[];

  const useVector = !!embedder && rows.some((r) => r.embedding && r.embed_model === embedder.model) && (await embedder.ready());
  let scored: Hit[];
  if (useVector) {
    const qv = await embedder!.embedQuery(query);
    scored = rows
      .filter((r) => r.embedding && r.embed_model === embedder!.model)
      .map((r) => toHit(r, dot(qv, fromBlob(r.embedding!))))
      .filter((h) => h.score >= opts.minVectorScore);
  } else {
    scored = rows.map((r) => toHit(r, keywordScore(query, r.text))).filter((h) => h.score >= opts.minKeywordScore);
  }
  scored.sort((a, b) => b.score - a.score);
  return { hits: scored.slice(0, opts.topK), mode: useVector ? 'vector' : 'keyword' };
}

function toHit(r: ChunkRow, score: number): Hit {
  return {
    chunkId: r.id,
    itemId: r.item_id,
    itemName: r.item_name,
    attachmentId: r.attachment_id,
    filename: r.filename,
    text: r.text,
    score,
  };
}
