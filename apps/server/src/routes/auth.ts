import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { audit, HttpError, notFound, requirePerm, userOf, vaultOf, assertCan } from '../http/context';
import {
  findUserByUsername,
  hashPassword,
  toUserDTO,
  validatePassword,
  verifyPassword,
} from '../auth/users';
import { createSession, listSessions, revokeSession, revokeUserSessions, type SessionRow } from '../auth/sessions';
import { writeAudit } from '../modules/audit/audit';

export const SESSION_COOKIE = 'cat_session';

// 账号不存在时也做一次哈希校验，避免通过响应时间探测用户名
const DUMMY_HASH = await hashPassword('timing-equalizer-0');

export async function authRoutes(app: FastifyInstance, deps: AppDeps) {
  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { db } = vaultOf(req);
      const body = z.object({ username: z.string().min(1), password: z.string().min(1) }).parse(req.body);
      const user = findUserByUsername(db, body.username);
      const ok = await verifyPassword(user?.password_hash ?? DUMMY_HASH, body.password);
      if (!user || !ok || user.disabled) {
        writeAudit(db, {
          userId: user?.id ?? null,
          username: body.username,
          action: 'auth.login.failed',
          detail: user?.disabled ? 'disabled' : 'bad_credentials',
          ip: req.ip,
        });
        throw new HttpError(401, '用户名或密码错误');
      }
      const device = String(req.headers['user-agent'] ?? 'unknown');
      const { token, session } = createSession(db, user.id, device, req.ip, deps.config.sessionTtlDays);
      writeAudit(db, { userId: user.id, username: user.username, action: 'auth.login', target: session.id, ip: req.ip });
      reply.setCookie(SESSION_COOKIE, token, {
        path: '/',
        httpOnly: true,
        secure: !deps.config.plainHttp,
        sameSite: 'strict',
        maxAge: deps.config.sessionTtlDays * 86400,
      });
      return { user: toUserDTO(user) };
    },
  );

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.auth) {
      revokeSession(vaultOf(req).db, req.auth.session.id);
      audit(req, 'auth.logout', req.auth.session.id);
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => ({ user: toUserDTO(userOf(req)) }));

  app.post('/api/auth/password', async (req) => {
    const user = userOf(req);
    const { db } = vaultOf(req);
    const body = z.object({ oldPassword: z.string(), newPassword: z.string() }).parse(req.body);
    if (!(await verifyPassword(user.password_hash, body.oldPassword))) throw new HttpError(400, '原密码不正确');
    const err = validatePassword(body.newPassword, deps.config.devInsecure);
    if (err) throw new HttpError(400, err);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(body.newPassword), user.id);
    // 修改密码后，其他设备全部下线
    revokeUserSessions(db, user.id, req.auth!.session.id);
    audit(req, 'auth.password.change', user.id);
    return { ok: true };
  });

  app.get('/api/auth/sessions', async (req) => {
    const user = userOf(req);
    const { db } = vaultOf(req);
    const all = (req.query as { all?: string }).all === '1';
    if (all) assertCan(req, 'session.revokeAny');
    const rows = listSessions(db, all ? undefined : user.id);
    return rows.map((s) => ({ ...s, current: s.id === req.auth!.session.id }));
  });

  app.delete('/api/auth/sessions/:id', async (req) => {
    const user = userOf(req);
    const { db } = vaultOf(req);
    const { id } = req.params as { id: string };
    const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
    if (!s) throw notFound('会话');
    if (s.user_id !== user.id) assertCan(req, 'session.revokeAny');
    revokeSession(db, id);
    audit(req, 'session.revoke', id, { userId: s.user_id });
    return { ok: true };
  });

  app.post('/api/users/:id/revoke-sessions', { preHandler: requirePerm('session.revokeAny') }, async (req) => {
    const { id } = req.params as { id: string };
    const n = revokeUserSessions(vaultOf(req).db, id);
    audit(req, 'session.revokeAll', id, { count: n });
    return { revoked: n };
  });
}
