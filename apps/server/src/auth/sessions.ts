import crypto from 'node:crypto';
import type { SessionDTO } from '@catalogue/shared';
import { newId, nowIso, type DB } from '../db';

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  device: string;
  ip: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
}

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export function createSession(db: DB, userId: string, device: string, ip: string, ttlDays: number) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const row: SessionRow = {
    id: newId(),
    user_id: userId,
    token_hash: hashToken(token),
    device: device.slice(0, 200),
    ip,
    created_at: now.toISOString(),
    last_seen_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttlDays * 86400_000).toISOString(),
    revoked_at: null,
  };
  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, device, ip, created_at, last_seen_at, expires_at, revoked_at)
     VALUES (@id, @user_id, @token_hash, @device, @ip, @created_at, @last_seen_at, @expires_at, @revoked_at)`,
  ).run(row);
  return { token, session: row };
}

/** 校验 token，返回有效会话并刷新最近活跃时间 */
export function resolveSession(db: DB, token: string): SessionRow | null {
  const row = db
    .prepare('SELECT * FROM sessions WHERE token_hash = ? AND revoked_at IS NULL')
    .get(hashToken(token)) as SessionRow | undefined;
  if (!row || row.expires_at < nowIso()) return null;
  // 降低写入频率：一分钟内只更新一次
  if (Date.now() - Date.parse(row.last_seen_at) > 60_000) {
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(nowIso(), row.id);
  }
  return row;
}

export function revokeSession(db: DB, id: string): void {
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(nowIso(), id);
}

export function revokeUserSessions(db: DB, userId: string, exceptId?: string): number {
  return db
    .prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND id != ?')
    .run(nowIso(), userId, exceptId ?? '').changes;
}

export function listSessions(db: DB, userId?: string): SessionDTO[] {
  const rows = db
    .prepare(
      `SELECT s.id, s.user_id AS userId, u.username, s.device, s.ip, s.created_at AS createdAt, s.last_seen_at AS lastSeenAt
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.revoked_at IS NULL AND s.expires_at > ? ${userId ? 'AND s.user_id = ?' : ''}
       ORDER BY s.last_seen_at DESC`,
    )
    .all(...(userId ? [nowIso(), userId] : [nowIso()]));
  return rows as SessionDTO[];
}
