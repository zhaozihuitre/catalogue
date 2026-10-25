import nodemailer from 'nodemailer';
import type { ItemDTO, NotificationType } from '@catalogue/shared';
import { newId, nowIso, type DB } from '../../db';
import { getSettings, type AppSettings, type SmtpSettings } from '../../db/settings';
import { ITEM_SELECT, rowToItem } from '../items/items';

export interface ReminderCandidate {
  type: NotificationType;
  itemId: string;
  dedupeKey: string;
  title: string;
  body: string;
}

/** 本机时区的今天，格式 YYYY-MM-DD */
export function localToday(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const DAY = 86400_000;
const toDays = (ymd: string) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / DAY;
export const daysBetween = (from: string, to: string) => toDays(to) - toDays(from);
export const addDays = (ymd: string, n: number) => new Date((toDays(ymd) + n) * DAY).toISOString().slice(0, 10);

/** 纯函数：根据藏品数据和当天日期计算应发出的提醒，dedupeKey 保证同一事件只提醒一次 */
export function computeReminders(items: ItemDTO[], today: string, cfg: AppSettings['reminders']): ReminderCandidate[] {
  const out: ReminderCandidate[] = [];
  const leads = [...cfg.insuranceLeadDays].sort((a, b) => a - b);

  for (const item of items) {
    const label = `「${item.name}」(${item.code})`;

    if (item.insuranceExpiry && leads.length) {
      const left = daysBetween(today, item.insuranceExpiry);
      if (left < 0) {
        out.push({
          type: 'insurance_expiry',
          itemId: item.id,
          dedupeKey: `insurance:${item.id}:${item.insuranceExpiry}:expired`,
          title: '保险已过期',
          body: `${label}的保险已于 ${item.insuranceExpiry} 到期，请尽快续保。`,
        });
      } else {
        const lead = leads.find((l) => left <= l);
        if (lead !== undefined) {
          out.push({
            type: 'insurance_expiry',
            itemId: item.id,
            dedupeKey: `insurance:${item.id}:${item.insuranceExpiry}:${lead}`,
            title: left === 0 ? '保险今日到期' : '保险即将到期',
            body: `${label}的保险将于 ${item.insuranceExpiry} 到期（剩余 ${left} 天）。`,
          });
        }
      }
    }

    const base = item.lastMaintenanceDate ?? item.purchaseDate;
    if (item.maintenanceCycleDays && base) {
      const due = addDays(base, item.maintenanceCycleDays);
      const left = daysBetween(today, due);
      if (left <= cfg.maintenanceLeadDays) {
        out.push({
          type: 'maintenance_due',
          itemId: item.id,
          dedupeKey: `maintenance:${item.id}:${due}`,
          title: left < 0 ? '藏品保养已逾期' : '藏品保养即将到期',
          body:
            left < 0
              ? `${label}应于 ${due} 保养，已逾期 ${-left} 天。`
              : `${label}应于 ${due} 保养（剩余 ${left} 天）。`,
        });
      }
    }

    const inv = item.lastInventoryDate ?? item.createdAt.slice(0, 10);
    const since = daysBetween(inv, today);
    if (since >= cfg.inventoryOverdueDays) {
      out.push({
        type: 'inventory_overdue',
        itemId: item.id,
        dedupeKey: `inventory:${item.id}:${inv}`,
        title: '藏品长期未盘点',
        body: `${label}自 ${inv} 起已 ${since} 天未盘点，请核对实物。`,
      });
    }
  }
  return out;
}

export async function runReminderScan(db: DB, now = new Date()): Promise<ReminderCandidate[]> {
  const settings = getSettings(db);
  const items = (db.prepare(ITEM_SELECT).all() as Record<string, unknown>[]).map(rowToItem);
  const candidates = computeReminders(items, localToday(now), settings.reminders);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO notifications (id, type, item_id, title, body, dedupe_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const created = db.transaction(() =>
    candidates.filter((c) => insert.run(newId(), c.type, c.itemId, c.title, c.body, c.dedupeKey, nowIso()).changes > 0),
  )();
  if (created.length && settings.smtp.enabled) {
    await sendDigest(settings.smtp, created);
    db.prepare(
      `UPDATE notifications SET emailed_at = ? WHERE dedupe_key IN (${created.map(() => '?').join(',')})`,
    ).run(nowIso(), ...created.map((c) => c.dedupeKey));
  }
  return created;
}

/** 通过客户自己的邮件服务器发送提醒摘要，邮件中不包含价格、证书等敏感信息 */
export async function sendDigest(smtp: SmtpSettings, items: ReminderCandidate[]): Promise<void> {
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
  await transport.sendMail({
    from: smtp.from,
    to: smtp.to,
    subject: `[藏册] ${items.length} 条藏品提醒`,
    text: `${items.map((c) => `· ${c.title}：${c.body}`).join('\n')}\n\n请登录藏册系统查看详情。`,
  });
}
