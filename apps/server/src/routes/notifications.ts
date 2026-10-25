import type { FastifyInstance } from 'fastify';
import type { NotificationDTO } from '@catalogue/shared';
import { audit, requirePerm, userOf, vaultOf } from '../http/context';
import { runReminderScan } from '../modules/reminders/reminders';
import { nowIso } from '../db';

export async function notificationRoutes(app: FastifyInstance) {
  const read = { preHandler: requirePerm('notification.read') };

  app.get('/api/notifications', read, async (req) => {
    const user = userOf(req);
    const unreadOnly = (req.query as { unread?: string }).unread === '1';
    const rows = vaultOf(req)
      .db.prepare(
        `SELECT n.id, n.type, n.item_id AS itemId, n.title, n.body, n.created_at AS createdAt,
           (r.user_id IS NOT NULL) AS read
         FROM notifications n LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ?
         ${unreadOnly ? 'WHERE r.user_id IS NULL' : ''}
         ORDER BY n.created_at DESC LIMIT 200`,
      )
      .all(user.id) as (Omit<NotificationDTO, 'read'> & { read: number })[];
    return rows.map((r) => ({ ...r, read: !!r.read }));
  });

  app.get('/api/notifications/unread-count', read, async (req) => {
    const row = vaultOf(req)
      .db.prepare(
        `SELECT count(*) AS n FROM notifications n
         WHERE NOT EXISTS (SELECT 1 FROM notification_reads r WHERE r.notification_id = n.id AND r.user_id = ?)`,
      )
      .get(userOf(req).id) as { n: number };
    return { count: row.n };
  });

  app.post('/api/notifications/:id/read', read, async (req) => {
    vaultOf(req)
      .db.prepare('INSERT OR IGNORE INTO notification_reads (notification_id, user_id, read_at) VALUES (?, ?, ?)')
      .run((req.params as { id: string }).id, userOf(req).id, nowIso());
    return { ok: true };
  });

  app.post('/api/notifications/read-all', read, async (req) => {
    vaultOf(req)
      .db.prepare(
        `INSERT OR IGNORE INTO notification_reads (notification_id, user_id, read_at)
         SELECT id, ?, ? FROM notifications`,
      )
      .run(userOf(req).id, nowIso());
    return { ok: true };
  });

  app.post('/api/reminders/run', { preHandler: requirePerm('settings.manage') }, async (req) => {
    const created = await runReminderScan(vaultOf(req).db);
    audit(req, 'reminder.run', null, { created: created.length });
    return { created: created.length };
  });
}
