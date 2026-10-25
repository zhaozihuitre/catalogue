import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import type { Config } from './config';
import type { AiServices } from './ai/services';
import type { VaultManager } from './vault';
import { HttpError } from './http/context';
import { findUserById } from './auth/users';
import { resolveSession } from './auth/sessions';
import { MAX_UPLOAD_BYTES } from './modules/files/attachments';
import { systemRoutes } from './routes/system';
import { authRoutes, SESSION_COOKIE } from './routes/auth';
import { userRoutes } from './routes/users';
import { itemRoutes } from './routes/items';
import { attachmentRoutes } from './routes/attachments';
import { aiRoutes } from './routes/ai';
import { notificationRoutes } from './routes/notifications';
import { adminRoutes } from './routes/admin';
import { exhibitRoutes } from './routes/exhibit';

export interface AppDeps {
  config: Config;
  vaults: VaultManager;
  ai: AiServices;
}

/** 无需登录即可访问的接口 */
const PUBLIC_API = new Set(['/api/system/status', '/api/system/unlock', '/api/auth/login']);
/** 系统锁定时仍可访问的接口 */
const LOCKED_OK = new Set(['/api/system/status', '/api/system/unlock']);

export const CSRF_HEADER = 'x-catalogue';

export async function buildApp(deps: AppDeps, opts: FastifyServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: false,
    bodyLimit: 1024 * 1024,
    logger: opts.logger ?? {
      level: 'info',
      // 日志里不记录查询参数（可能含搜索词等档案内容）和请求头
      serializers: {
        req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url.split('?')[0] }),
      },
    },
    ...opts,
  });

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'blob:', 'data:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        // 以 HTTP 提供服务时不能强制升级，否则同源请求会失败
        upgradeInsecureRequests: deps.config.plainHttp ? null : [],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: !deps.config.plainHttp,
  });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES } });

  app.decorateRequest('auth', null);
  app.decorateRequest('vault', null);

  app.addHook('onRequest', async (req) => {
    req.vault = deps.vaults.current;
    req.auth = null;
    const url = req.url.split('?')[0];
    if (!url.startsWith('/api/')) return;

    // 防 CSRF：写操作必须带自定义请求头（跨站表单无法设置），配合 SameSite=Strict cookie
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers[CSRF_HEADER] !== '1') {
      throw new HttpError(403, '缺少请求校验头');
    }
    if (!req.vault) {
      if (!LOCKED_OK.has(url)) throw new HttpError(423, '系统已锁定，请先输入主口令解锁');
      return;
    }

    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      const session = resolveSession(req.vault.db, token);
      const user = session ? findUserById(req.vault.db, session.user_id) : undefined;
      if (session && user && !user.disabled) req.auth = { user, session };
    }
    if (!req.auth && !PUBLIC_API.has(url)) throw new HttpError(401, '登录已失效，请重新登录');
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      return reply.status(400).send({ error: issue ? `${issue.path.join('.') || '参数'}：${issue.message}` : '参数错误' });
    }
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: (err as Error).message });
    req.log.error(err);
    return reply.status(500).send({ error: '服务器内部错误' });
  });

  await app.register(async (s) => systemRoutes(s, deps));
  await app.register(async (s) => authRoutes(s, deps));
  await app.register(async (s) => userRoutes(s, deps));
  await app.register(itemRoutes);
  await app.register(attachmentRoutes);
  await app.register(async (s) => aiRoutes(s, deps));
  await app.register(notificationRoutes);
  await app.register(adminRoutes);
  await app.register(exhibitRoutes);

  // 生产环境由后端直接托管前端构建产物（含 PWA）
  if (fs.existsSync(path.join(deps.config.webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: deps.config.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.method !== 'GET') return reply.status(404).send({ error: '接口不存在' });
      return reply.type('text/html').header('Cache-Control', 'no-cache').sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: '接口不存在' }));
  }

  return app;
}
