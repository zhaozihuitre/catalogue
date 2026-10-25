import { hash, verify } from '@node-rs/argon2';
import type { Role, UserDTO } from '@catalogue/shared';
import { newId, nowIso, type DB } from '../db';

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  role: Role;
  disabled: number;
  created_at: string;
}

export function toUserDTO(r: UserRow): UserDTO {
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    role: r.role,
    disabled: !!r.disabled,
    createdAt: r.created_at,
  };
}

/** relaxed 仅用于本机开发模式（CATALOGUE_DEV_INSECURE=1），允许简单密码 */
export function validatePassword(pw: string, relaxed = false): string | null {
  if (relaxed) return pw.length >= 1 ? null : '密码不能为空';
  if (pw.length < 10) return '密码至少 10 位';
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return '密码需同时包含字母和数字';
  return null;
}

export async function hashPassword(pw: string): Promise<string> {
  return hash(pw);
}

export async function verifyPassword(stored: string, pw: string): Promise<boolean> {
  try {
    return await verify(stored, pw);
  } catch {
    return false;
  }
}

export function findUserByUsername(db: DB, username: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
}

export function findUserById(db: DB, id: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export async function createUser(
  db: DB,
  input: { username: string; displayName: string; password: string; role: Role },
): Promise<UserRow> {
  const row: UserRow = {
    id: newId(),
    username: input.username.trim(),
    display_name: input.displayName.trim() || input.username.trim(),
    password_hash: await hashPassword(input.password),
    role: input.role,
    disabled: 0,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO users (id, username, display_name, password_hash, role, disabled, created_at)
     VALUES (@id, @username, @display_name, @password_hash, @role, @disabled, @created_at)`,
  ).run(row);
  return row;
}

export function countActiveOwners(db: DB): number {
  return (db.prepare(`SELECT count(*) AS n FROM users WHERE role = 'owner' AND disabled = 0`).get() as { n: number }).n;
}
