import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Permission } from '@catalogue/shared';
import { audit, HttpError, requirePerm, vaultOf } from '../http/context';
import { queryAudit } from '../modules/audit/audit';
import { buildInsuranceList, buildLedger, buildStats } from '../modules/export/export';
import { localToday, sendDigest } from '../modules/reminders/reminders';
import { getSettings, saveSettings } from '../db/settings';
import type { DB } from '../db';

const EXPORTS: Record<string, { perm: Permission; name: string; build: (db: DB) => Promise<Buffer> }> = {
  ledger: { perm: 'export.ledger', name: '藏品台账', build: buildLedger },
  insurance: { perm: 'export.insurance', name: '保险清单', build: buildInsuranceList },
  stats: { perm: 'export.stats', name: '藏品统计', build: buildStats },
};

const settingsSchema = z.object({
  reminders: z
    .object({
      insuranceLeadDays: z.array(z.number().int().min(0).max(365)).max(5),
      maintenanceLeadDays: z.number().int().min(0).max(365),
      inventoryOverdueDays: z.number().int().min(7).max(3650),
    })
    .partial()
    .optional(),
  ai: z
    .object({
      minVectorScore: z.number().min(0).max(1),
      minKeywordScore: z.number().min(0).max(1),
      topK: z.number().int().min(1).max(20),
    })
    .partial()
    .optional(),
  smtp: z
    .object({
      enabled: z.boolean(),
      host: z.string().max(200),
      port: z.number().int().min(1).max(65535),
      secure: z.boolean(),
      user: z.string().max(200),
      pass: z.string().max(200),
      from: z.string().max(200),
      to: z.string().max(500),
    })
    .partial()
    .optional(),
});

/** 返回给前端时隐藏 SMTP 密码 */
function publicSettings(db: DB) {
  const s = getSettings(db);
  return { ...s, smtp: { ...s.smtp, pass: s.smtp.pass ? '********' : '' } };
}

export async function adminRoutes(app: FastifyInstance) {
  for (const [key, ex] of Object.entries(EXPORTS)) {
    app.get(`/api/export/${key}.xlsx`, { preHandler: requirePerm(ex.perm) }, async (req, reply) => {
      const buf = await ex.build(vaultOf(req).db);
      audit(req, 'export', key);
      const filename = `${ex.name}_${localToday()}.xlsx`;
      reply.header('Cache-Control', 'private, no-store');
      reply.header('Content-Disposition', `attachment; filename="${key}.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`);
      return reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(buf);
    });
  }

  app.get('/api/audit', { preHandler: requirePerm('audit.read') }, async (req) => {
    const q = z
      .object({
        userId: z.string().optional(),
        action: z.string().max(60).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(req.query);
    return queryAudit(vaultOf(req).db, q);
  });

  app.get('/api/settings', { preHandler: requirePerm('settings.manage') }, async (req) => publicSettings(vaultOf(req).db));

  app.put('/api/settings', { preHandler: requirePerm('settings.manage') }, async (req) => {
    const { db } = vaultOf(req);
    const body = settingsSchema.parse(req.body);
    // 前端回传掩码时保留原密码
    if (body.smtp?.pass === '********') delete body.smtp.pass;
    saveSettings(db, body as never);
    audit(req, 'settings.update', null, { ...body, smtp: body.smtp ? { ...body.smtp, pass: undefined } : undefined });
    return publicSettings(db);
  });

  app.post('/api/settings/smtp/test', { preHandler: requirePerm('settings.manage') }, async (req) => {
    const { smtp } = getSettings(vaultOf(req).db);
    if (!smtp.host || !smtp.to) throw new HttpError(400, '请先填写 SMTP 服务器和收件人');
    try {
      await sendDigest(smtp, [
        { type: 'inventory_overdue', itemId: '', dedupeKey: 'test', title: '测试邮件', body: '藏册邮件提醒配置成功。' },
      ]);
    } catch (e) {
      throw new HttpError(502, `发送失败：${(e as Error).message}`);
    }
    audit(req, 'settings.smtpTest');
    return { ok: true };
  });
}
