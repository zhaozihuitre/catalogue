import type { FastifyBaseLogger } from 'fastify';
import { CORE_ATTACHMENT_KINDS } from '@catalogue/shared';
import type { DB } from '../db';
import type { Vault } from '../vault';
import { getAttachment, readOriginal } from '../modules/files/attachments';
import { getCategory, getItem, itemCardText } from '../modules/items/items';
import { claimJob, completeJob, deferJob, failJob, requeueStale, type JobRow } from '../modules/jobs/jobs';
import { chunkText } from './chunk';
import { toBlob } from './embedder';
import { extractText, OcrUnavailableError } from './extract';
import { summarize } from './rag';
import type { AiServices } from './services';
import { getSummary, saveSummary } from './summaries';

const POLL_MS = 2000;
const BACKFILL_MS = 60_000;

/**
 * 后台处理流水线：提取文本 → 切片 → 向量化 → 摘要。
 * 依赖服务未就绪时延后执行；服务就绪后由 backfill 补齐缺失的向量和摘要。
 */
export class AiWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastBackfill = 0;

  constructor(
    private readonly ai: AiServices,
    private readonly log: FastifyBaseLogger,
  ) {}

  start(vault: Vault): void {
    this.stop();
    requeueStale(vault.db);
    const loop = async () => {
      if (this.running) return;
      this.running = true;
      try {
        await this.tick(vault);
      } catch (e) {
        this.log.error(e, 'ai worker tick failed');
      } finally {
        this.running = false;
      }
    };
    this.timer = setInterval(loop, POLL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 处理队列直到为空（测试中直接调用） */
  async drain(vault: Vault): Promise<void> {
    while (await this.runOne(vault)) {
      /* 继续 */
    }
  }

  private async tick(vault: Vault): Promise<void> {
    if (await this.runOne(vault)) return;
    if (Date.now() - this.lastBackfill > BACKFILL_MS) {
      this.lastBackfill = Date.now();
      await this.backfill(vault.db);
    }
  }

  private async runOne(vault: Vault): Promise<boolean> {
    const job = claimJob(vault.db);
    if (!job) return false;
    try {
      const payload = JSON.parse(job.payload);
      if (job.type === 'process_attachment') await this.processAttachment(vault, job, payload.attachmentId);
      else if (job.type === 'index_item') await this.indexItem(vault.db, payload.itemId);
      completeJob(vault.db, job.id);
    } catch (e) {
      if (e instanceof DeferredError) return true;
      const msg = (e as Error).message;
      this.log.warn({ jobId: job.id, type: job.type, err: msg }, 'ai job failed');
      const retry = failJob(vault.db, job, msg);
      if (!retry && job.type === 'process_attachment') {
        const id = JSON.parse(job.payload).attachmentId;
        vault.db.prepare(`UPDATE attachments SET ai_status = 'failed', ai_error = ? WHERE id = ?`).run(msg, id);
      }
    }
    return true;
  }

  private async processAttachment(vault: Vault, job: JobRow, attachmentId: string): Promise<void> {
    const { db, files } = vault;
    const a = getAttachment(db, attachmentId);
    if (!a) return;
    const setStatus = (status: string, error: string | null) =>
      db.prepare('UPDATE attachments SET ai_status = ?, ai_error = ? WHERE id = ?').run(status, error, a.id);

    setStatus('processing', null);
    let text: string;
    try {
      text = (await extractText(readOriginal(files, a), a.mime, this.ai.ocr)).text;
    } catch (e) {
      if (e instanceof OcrUnavailableError) {
        setStatus('pending', '本地 OCR 服务未就绪，就绪后自动识别');
        deferJob(db, job, e.message, 5 * 60_000);
        throw new DeferredError();
      }
      throw e;
    }

    db.prepare('UPDATE attachments SET extracted_text = ? WHERE id = ?').run(text, a.id);
    await this.writeChunks(db, a.item_id, a.id, chunkText(text));

    const notes: string[] = [];
    if (!text.trim()) notes.push('未识别到文字');
    else if (CORE_ATTACHMENT_KINDS.includes(a.kind) || a.mime === 'application/pdf') {
      if (await this.ai.llm.health()) saveSummary(db, a.id, await summarize(this.ai.llm, text), this.ai.llm.model);
      else notes.push('本地大模型未就绪，摘要稍后自动生成');
    }
    if (!(await this.ai.embedder.ready())) notes.push('向量模型未就绪，暂用关键词检索');
    setStatus(text.trim() ? 'done' : 'skipped', notes.join('；') || null);
  }

  private async indexItem(db: DB, itemId: string): Promise<void> {
    const item = getItem(db, itemId);
    if (!item) return;
    await this.writeChunks(db, itemId, null, [itemCardText(item, getCategory(db, item.categoryId))]);
  }

  private async writeChunks(db: DB, itemId: string, attachmentId: string | null, chunks: string[]): Promise<void> {
    const embeddings = chunks.length && (await this.ai.embedder.ready()) ? await this.ai.embedder.embed(chunks) : null;
    const model = embeddings ? this.ai.embedder.model : null;
    db.transaction(() => {
      if (attachmentId) db.prepare('DELETE FROM doc_chunks WHERE attachment_id = ?').run(attachmentId);
      else db.prepare('DELETE FROM doc_chunks WHERE item_id = ? AND attachment_id IS NULL').run(itemId);
      const insert = db.prepare(
        'INSERT INTO doc_chunks (item_id, attachment_id, seq, text, embedding, embed_model) VALUES (?, ?, ?, ?, ?, ?)',
      );
      chunks.forEach((c, i) => insert.run(itemId, attachmentId, i, c, embeddings ? toBlob(embeddings[i]) : null, model));
    })();
  }

  /** AI 服务后来才就绪时，补齐缺失的向量与摘要 */
  async backfill(db: DB): Promise<void> {
    if (await this.ai.embedder.ready()) {
      const model = this.ai.embedder.model;
      const rows = db
        .prepare('SELECT id, text FROM doc_chunks WHERE embed_model IS NULL OR embed_model != ? LIMIT 64')
        .all(model) as { id: number; text: string }[];
      if (rows.length) {
        const vecs = await this.ai.embedder.embed(rows.map((r) => r.text));
        const upd = db.prepare('UPDATE doc_chunks SET embedding = ?, embed_model = ? WHERE id = ?');
        db.transaction(() => rows.forEach((r, i) => upd.run(toBlob(vecs[i]), model, r.id)))();
        this.log.info({ count: rows.length }, 'backfilled embeddings');
      }
    }
    if (await this.ai.llm.health()) {
      const pending = db
        .prepare(
          `SELECT a.id, a.extracted_text FROM attachments a LEFT JOIN ai_summaries s ON s.attachment_id = a.id
           WHERE s.attachment_id IS NULL AND a.ai_status = 'done' AND length(a.extracted_text) > 0
             AND (a.mime = 'application/pdf' OR a.kind IN (${CORE_ATTACHMENT_KINDS.map(() => '?').join(',')}))
           LIMIT 3`,
        )
        .all(...CORE_ATTACHMENT_KINDS) as { id: string; extracted_text: string }[];
      for (const p of pending) {
        if (getSummary(db, p.id)) continue;
        saveSummary(db, p.id, await summarize(this.ai.llm, p.extracted_text), this.ai.llm.model);
        db.prepare('UPDATE attachments SET ai_error = NULL WHERE id = ?').run(p.id);
      }
    }
  }
}

class DeferredError extends Error {}
