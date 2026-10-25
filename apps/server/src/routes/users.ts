import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ROLES } from '@catalogue/shared';
import type { AppDeps } from '../app';
import { audit, HttpError, notFound, requirePerm, vaultOf } from '../http/context';
import {
  countActiveOwners,
  createUser,
  findUserById,
  findUserByUsername,
  hashPassword,
  toUserDTO,
  validatePassword,
  type UserRow,
} from '../auth/users';
import { revokeUserSessions } from '../auth/sessions';

const createSchema = z.object({
  username: z.string().trim().min(2).max(40).regex(/^[\w.@-]+$/, '用户名只能包含字母、数字和 . _ - @'),
  displayName: z.string().trim().max(40).default(''),
  password: z.string(),
  role: z.enum(ROLES),
});

const updateSchema = z.object({
  displayName: z.string().trim().min(1).max(40).optional(),
  role: z.enum(ROLES).optional(),
  disabled: z.boolean().optional(),
  password: z.string().optional(),
});

export async function userRoutes(app: FastifyInstance, deps: AppDeps) {
  const manage = { preHandler: requirePerm('user.manage') };

  app.get('/api/users', manage, async (req) => {
    const rows = vaultOf(req).db.prepare('SELECT * FROM users ORDER BY created_at').all() as UserRow[];
    return rows.map(toUserDTO);
  });

  app.post('/api/users', manage, async (req) => {
    const { db } = vaultOf(req);
    const body = createSchema.parse(req.body);
    const err = validatePassword(body.password, deps.config.devInsecure);
    if (err) throw new HttpError(400, err);
    if (findUserByUsername(db, body.username)) throw new HttpError(409, '用户名已存在');
    const user = await createUser(db, body);
    audit(req, 'user.create', user.id, { username: user.username, role: user.role });
    return toUserDTO(user);
  });

  app.patch('/api/users/:id', manage, async (req) => {
    const { db } = vaultOf(req);
    const { id } = req.params as { id: string };
    const body = updateSchema.parse(req.body);
    const user = findUserById(db, id);
    if (!user) throw notFound('用户');

    const losesOwner = user.role === 'owner' && !user.disabled && ((body.role && body.role !== 'owner') || body.disabled);
    if (losesOwner && countActiveOwners(db) <= 1) throw new HttpError(400, '至少需要保留一个可用的超级管理员');

    if (body.password !== undefined) {
      const err = validatePassword(body.password, deps.config.devInsecure);
      if (err) throw new HttpError(400, err);
    }

    db.transaction(() => {
      if (body.displayName !== undefined) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(body.displayName, id);
      if (body.role !== undefined) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(body.role, id);
      if (body.disabled !== undefined) db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(body.disabled ? 1 : 0, id);
    })();
    if (body.password !== undefined) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(body.password), id);
    }
    // 禁用、改角色、重置密码都会让该用户所有设备下线
    if (body.disabled || body.role !== undefined || body.password !== undefined) revokeUserSessions(db, id);

    audit(req, 'user.update', id, { ...body, password: body.password !== undefined ? '***' : undefined });
    return toUserDTO(findUserById(db, id)!);
  });
}
