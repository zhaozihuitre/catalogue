import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { PRESET_CATEGORIES } from '@catalogue/shared';
import { MIGRATIONS } from './migrations';

export type DB = Database.Database;

export const DB_FILE = 'catalogue.db';

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

/** 打开 SQLCipher 加密库。密钥错误时抛出异常。 */
export function openDatabase(dataDir: string, dbKey: string): DB {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, DB_FILE));
  db.pragma(`cipher='sqlcipher'`);
  db.pragma(`legacy=4`);
  db.pragma(`key="x'${dbKey}'"`);
  try {
    db.prepare('SELECT count(*) FROM sqlite_master').get();
  } catch {
    db.close();
    throw new Error('主口令错误，无法解密数据库');
  }
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('secure_delete = ON');
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

export function seedCategories(db: DB): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO categories (id, code, name, fields, builtin, sort, created_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
  );
  PRESET_CATEGORIES.forEach((c, i) => insert.run(newId(), c.code, c.name, JSON.stringify(c.fields), i, nowIso()));

  // 已存在的预设类目：只同步"敏感字段"标记，保留藏家自己改过的字段
  const rows = db.prepare('SELECT id, code, fields FROM categories WHERE builtin = 1').all() as {
    id: string;
    code: string;
    fields: string;
  }[];
  const update = db.prepare('UPDATE categories SET fields = ? WHERE id = ?');
  for (const row of rows) {
    const preset = PRESET_CATEGORIES.find((p) => p.code === row.code);
    if (!preset) continue;
    const privateKeys = new Set(preset.fields.filter((f) => f.private).map((f) => f.key));
    const fields = JSON.parse(row.fields) as { key: string; private?: boolean }[];
    let changed = false;
    for (const f of fields) {
      if (privateKeys.has(f.key) && !f.private) {
        f.private = true;
        changed = true;
      }
    }
    if (changed) update.run(JSON.stringify(fields), row.id);
  }
}
