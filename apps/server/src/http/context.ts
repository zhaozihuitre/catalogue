import type { FastifyReply, FastifyRequest } from 'fastify';
import { can, type Permission } from '@catalogue/shared';
import type { UserRow } from '../auth/users';
import type { SessionRow } from '../auth/sessions';
import type { Vault } from '../vault';
import { writeAudit } from '../modules/audit/audit';

declare module 'fastify' {
  interface FastifyRequest {
    auth: { user: UserRow; session: SessionRow } | null;
    vault: Vault | null;
  }
}

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = '资源') => new HttpError(404, `${what}不存在`);

export function vaultOf(req: FastifyRequest): Vault {
  if (!req.vault) throw new HttpError(423, '系统已锁定，请先输入主口令解锁');
  return req.vault;
}

export function userOf(req: FastifyRequest): UserRow {
  if (!req.auth) throw new HttpError(401, '请先登录');
  return req.auth.user;
}

export function assertCan(req: FastifyRequest, permission: Permission): void {
  const user = userOf(req);
  if (!can(user.role, permission)) {
    audit(req, 'permission.denied', permission);
    throw new HttpError(403, '无权执行此操作');
  }
}

/** 路由级权限校验 */
export function requirePerm(permission: Permission) {
  return async (req: FastifyRequest, _reply: FastifyReply) => assertCan(req, permission);
}

export function audit(req: FastifyRequest, action: string, target?: string | null, detail?: unknown): void {
  if (!req.vault) return;
  writeAudit(req.vault.db, {
    userId: req.auth?.user.id ?? null,
    username: req.auth?.user.username ?? null,
    action,
    target,
    detail,
    ip: req.ip,
  });
}
