import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AiHealth } from '@catalogue/shared';
import { buildApp, CSRF_HEADER } from '../src/app';
import { loadConfig } from '../src/config';
import { createKeystore } from '../src/crypto/keys';
import { VaultManager } from '../src/vault';
import { createUser } from '../src/auth/users';
import type { AiServices } from '../src/ai/services';
import type { Embedder } from '../src/ai/embedder';
import type { Llm, ChatMessage } from '../src/ai/llm';
import { OcrClient } from '../src/ai/ocr';

export const PASSPHRASE = 'test-passphrase-123';
export const PASSWORD = 'Password1234';

export function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'catalogue-test-'));
}

/** 测试用低成本 KDF 参数 */
export function initVault(dataDir: string): VaultManager {
  createKeystore(dataDir, { N: 2 ** 10 });
  const vaults = new VaultManager(loadConfig({ dataDir }));
  vaults.unlock(PASSPHRASE);
  return vaults;
}

export class FakeLlm implements Llm {
  model = 'fake-llm';
  up = true;
  calls: ChatMessage[][] = [];
  reply: (messages: ChatMessage[]) => string = () => '测试回答 [1]';
  async health() {
    return this.up;
  }
  async chat(messages: ChatMessage[]) {
    this.calls.push(messages);
    return this.reply(messages);
  }
}

export function fakeAi(llm: Llm = new FakeLlm(), embedder: Embedder | null = null): AiServices {
  const noEmbedder: Embedder = {
    model: 'none',
    ready: async () => false,
    embed: async () => {
      throw new Error('not ready');
    },
    embedQuery: async () => {
      throw new Error('not ready');
    },
  };
  return {
    ocr: new OcrClient('http://127.0.0.1:1'),
    embedder: embedder ?? noEmbedder,
    llm,
    health: async (): Promise<AiHealth> => ({ ocr: false, embedder: false, llm: true, llmModel: llm.model, message: null }),
  };
}

export interface TestCtx {
  app: FastifyInstance;
  vaults: VaultManager;
  dataDir: string;
  llm: FakeLlm;
  ai: AiServices;
}

export async function setupApp(): Promise<TestCtx> {
  const dataDir = tmpDir();
  const vaults = initVault(dataDir);
  const db = vaults.current!.db;
  await createUser(db, { username: 'owner', displayName: '藏家', password: PASSWORD, role: 'owner' });
  await createUser(db, { username: 'assistant', displayName: '助理', password: PASSWORD, role: 'assistant' });
  await createUser(db, { username: 'viewer', displayName: '访客', password: PASSWORD, role: 'viewer' });
  const llm = new FakeLlm();
  const ai = fakeAi(llm);
  const app = await buildApp({ config: loadConfig({ dataDir, devInsecure: true }), vaults, ai }, { logger: false });
  return { app, vaults, dataDir, llm, ai };
}

/** 登录并返回带 cookie 和 CSRF 头的请求函数 */
export async function login(app: FastifyInstance, username: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { [CSRF_HEADER]: '1' },
    payload: { username, password: PASSWORD },
  });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === 'cat_session')!;
  const headers = { cookie: `cat_session=${cookie.value}`, [CSRF_HEADER]: '1' };
  return (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown, extra: Record<string, string> = {}) =>
    app.inject({ method, url, headers: { ...headers, ...extra }, payload: payload as never });
}

export function multipartBody(filename: string, data: Buffer, mime: string) {
  const boundary = '----catalogueTestBoundary';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}
