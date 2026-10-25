/**
 * 顺序执行的 SQL 迁移。只能追加新迁移，不能修改已发布的迁移。
 */
export const MIGRATIONS: string[] = [
  /* 001 初始结构 */ `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner','assistant','viewer')),
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    device TEXT NOT NULL,
    ip TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);

  CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    fields TEXT NOT NULL DEFAULT '[]',
    builtin INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE items (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category_id TEXT NOT NULL REFERENCES categories(id),
    purchase_date TEXT,
    purchase_channel TEXT,
    purchase_price REAL,
    market_price REAL,
    location TEXT,
    insurance_company TEXT,
    insurance_policy_no TEXT,
    insurance_amount REAL,
    insurance_expiry TEXT,
    maintenance_cycle_days INTEGER,
    last_maintenance_date TEXT,
    last_inventory_date TEXT,
    notes TEXT,
    attributes TEXT NOT NULL DEFAULT '{}',
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_items_category ON items(category_id);

  CREATE TABLE attachments (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    storage_key TEXT NOT NULL,
    wrapped_key BLOB NOT NULL,
    thumb_storage_key TEXT,
    thumb_wrapped_key BLOB,
    preview_storage_key TEXT,
    preview_wrapped_key BLOB,
    extracted_text TEXT,
    ai_status TEXT NOT NULL DEFAULT 'pending',
    ai_error TEXT,
    uploaded_by TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_attachments_item ON attachments(item_id);

  -- attachment_id 为空表示由藏品字段生成的"档案卡"片段
  CREATE TABLE doc_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    attachment_id TEXT REFERENCES attachments(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    text TEXT NOT NULL,
    embedding BLOB,
    embed_model TEXT
  );
  CREATE INDEX idx_chunks_item ON doc_chunks(item_id);
  CREATE INDEX idx_chunks_attachment ON doc_chunks(attachment_id);

  CREATE TABLE ai_summaries (
    attachment_id TEXT PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
    conclusion TEXT,
    era TEXT,
    material TEXT,
    institution TEXT,
    risk_notes TEXT,
    model TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    run_after TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_jobs_status ON jobs(status, run_after);

  CREATE TABLE notifications (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    item_id TEXT REFERENCES items(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    dedupe_key TEXT NOT NULL UNIQUE,
    emailed_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE notification_reads (
    notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at TEXT NOT NULL,
    PRIMARY KEY (notification_id, user_id)
  );

  CREATE TABLE audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    username TEXT,
    action TEXT NOT NULL,
    target TEXT,
    detail TEXT,
    ip TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_audit_created ON audit_logs(created_at);
  CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs
    BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
  CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs
    BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  /* 002 私人展览 */ `
  CREATE TABLE exhibitions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    item_ids TEXT NOT NULL DEFAULT '[]',
    interval_sec INTEGER NOT NULL DEFAULT 10,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
];
