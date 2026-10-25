import type { DB } from './index';

export interface SmtpSettings {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  to: string;
}

export interface AppSettings {
  reminders: {
    /** 保险到期前多少天提醒，可多档 */
    insuranceLeadDays: number[];
    /** 保养到期前多少天开始提醒 */
    maintenanceLeadDays: number;
    /** 超过多少天未盘点视为长期未盘点 */
    inventoryOverdueDays: number;
  };
  ai: {
    /** 向量检索最低相似度，低于此值视为无记录 */
    minVectorScore: number;
    /** 关键词检索最低得分（无 embedding 模型时使用） */
    minKeywordScore: number;
    topK: number;
  };
  smtp: SmtpSettings;
}

export const DEFAULT_SETTINGS: AppSettings = {
  reminders: { insuranceLeadDays: [30, 7, 0], maintenanceLeadDays: 7, inventoryOverdueDays: 180 },
  ai: { minVectorScore: 0.45, minKeywordScore: 0.3, topK: 6 },
  smtp: { enabled: false, host: '', port: 465, secure: true, user: '', pass: '', from: '', to: '' },
};

export function getSettings(db: DB): AppSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
  return {
    reminders: { ...DEFAULT_SETTINGS.reminders, ...stored.reminders },
    ai: { ...DEFAULT_SETTINGS.ai, ...stored.ai },
    smtp: { ...DEFAULT_SETTINGS.smtp, ...stored.smtp },
  };
}

export function saveSettings(db: DB, patch: Partial<AppSettings>): AppSettings {
  const current = getSettings(db);
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  db.transaction(() => {
    for (const key of Object.keys(patch) as (keyof AppSettings)[]) {
      upsert.run(key, JSON.stringify({ ...current[key], ...patch[key] }));
    }
  })();
  return getSettings(db);
}
