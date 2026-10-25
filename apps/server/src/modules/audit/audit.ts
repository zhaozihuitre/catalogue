import type { AuditLogDTO } from '@catalogue/shared';
import { nowIso, type DB } from '../../db';

export interface AuditEntry {
  userId?: string | null;
  username?: string | null;
  action: string;
  target?: string | null;
  detail?: unknown;
  ip?: string | null;
}

export function writeAudit(db: DB, e: AuditEntry): void {
  db.prepare(
    `INSERT INTO audit_logs (user_id, username, action, target, detail, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    e.userId ?? null,
    e.username ?? null,
    e.action,
    e.target ?? null,
    e.detail === undefined ? null : typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail),
    e.ip ?? null,
    nowIso(),
  );
}

export interface AuditQuery {
  userId?: string;
  action?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

export function queryAudit(db: DB, q: AuditQuery): { total: number; rows: AuditLogDTO[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.userId) (where.push('user_id = ?'), params.push(q.userId));
  if (q.action) (where.push('action LIKE ?'), params.push(`${q.action}%`));
  if (q.from) (where.push('created_at >= ?'), params.push(q.from));
  if (q.to) (where.push('created_at <= ?'), params.push(q.to));
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT count(*) AS n FROM audit_logs ${w}`).get(...params) as { n: number }).n;
  const rows = db
    .prepare(
      `SELECT id, user_id AS userId, username, action, target, detail, ip, created_at AS createdAt
       FROM audit_logs ${w} ORDER BY id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, q.pageSize, (q.page - 1) * q.pageSize) as AuditLogDTO[];
  return { total, rows };
}
