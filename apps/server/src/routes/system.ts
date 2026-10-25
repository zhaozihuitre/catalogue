import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { audit, HttpError, requirePerm } from '../http/context';
import { writeAudit } from '../modules/audit/audit';

export async function systemRoutes(app: FastifyInstance, deps: AppDeps) {
  app.get('/api/system/status', async () => ({
    initialized: deps.vaults.initialized,
    locked: deps.vaults.current === null,
  }));

  app.post(
    '/api/system/unlock',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req) => {
      const { passphrase } = z.object({ passphrase: z.string().min(1) }).parse(req.body);
      if (!deps.vaults.initialized) throw new HttpError(409, '系统尚未初始化，请在主机上运行 npm run init');
      try {
        const vault = deps.vaults.unlock(passphrase);
        writeAudit(vault.db, { action: 'system.unlock', ip: req.ip });
      } catch (e) {
        req.log.warn({ ip: req.ip }, 'vault unlock failed');
        throw new HttpError(401, (e as Error).message);
      }
      return { ok: true };
    },
  );

  app.post('/api/system/lock', { preHandler: requirePerm('settings.manage') }, async (req) => {
    audit(req, 'system.lock');
    deps.vaults.lock();
    return { ok: true };
  });
}
