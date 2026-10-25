import { nowIso, type DB } from '../../db';

export type JobType = 'process_attachment' | 'index_item' | 'reembed_all';

export interface JobRow {
  id: number;
  type: JobType;
  payload: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  attempts: number;
  last_error: string | null;
  run_after: string;
}

export const MAX_ATTEMPTS = 3;

export function enqueueJob(db: DB, type: JobType, payload: Record<string, unknown>): void {
  const now = nowIso();
  db.prepare(
    `INSERT INTO jobs (type, payload, status, attempts, run_after, created_at, updated_at)
     VALUES (?, ?, 'queued', 0, ?, ?, ?)`,
  ).run(type, JSON.stringify(payload), now, now, now);
}

/** 取出一个可执行任务并标记为运行中 */
export function claimJob(db: DB): JobRow | null {
  return db.transaction(() => {
    const job = db
      .prepare(`SELECT * FROM jobs WHERE status = 'queued' AND run_after <= ? ORDER BY id LIMIT 1`)
      .get(nowIso()) as JobRow | undefined;
    if (!job) return null;
    db.prepare(`UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?`).run(
      nowIso(),
      job.id,
    );
    return { ...job, attempts: job.attempts + 1 };
  })();
}

export function completeJob(db: DB, id: number): void {
  db.prepare(`UPDATE jobs SET status = 'done', last_error = NULL, updated_at = ? WHERE id = ?`).run(nowIso(), id);
}

/** 失败后指数退避重试，超过次数则标记失败 */
export function failJob(db: DB, job: JobRow, error: string, retryable = true): boolean {
  const willRetry = retryable && job.attempts < MAX_ATTEMPTS;
  const runAfter = new Date(Date.now() + 30_000 * 2 ** job.attempts).toISOString();
  db.prepare(`UPDATE jobs SET status = ?, last_error = ?, run_after = ?, updated_at = ? WHERE id = ?`).run(
    willRetry ? 'queued' : 'failed',
    error.slice(0, 1000),
    runAfter,
    nowIso(),
    job.id,
  );
  return willRetry;
}

/** 依赖服务（OCR 等）暂不可用：延后执行，不计入失败次数 */
export function deferJob(db: DB, job: JobRow, reason: string, delayMs: number): void {
  db.prepare(
    `UPDATE jobs SET status = 'queued', attempts = attempts - 1, last_error = ?, run_after = ?, updated_at = ? WHERE id = ?`,
  ).run(reason, new Date(Date.now() + delayMs).toISOString(), nowIso(), job.id);
}

/** 进程重启时，把上次中断的任务放回队列 */
export function requeueStale(db: DB): void {
  db.prepare(`UPDATE jobs SET status = 'queued', updated_at = ? WHERE status = 'running'`).run(nowIso());
}
