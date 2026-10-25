import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(serverRoot, '../..');

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

/** .env 中的相对路径一律相对仓库根目录，与进程工作目录无关 */
const fromRoot = (p: string) => path.resolve(repoRoot, p);

export interface Config {
  dataDir: string;
  host: string;
  port: number;
  tlsCert: string | null;
  tlsKey: string | null;
  /** 仅限本机开发：允许 HTTP 与简单密码，且强制只监听 127.0.0.1 */
  devInsecure: boolean;
  /** 允许在局域网用 HTTP 提供服务（客户家庭内网 / Tailscale 场景）。默认关闭 */
  allowHttp: boolean;
  /** 实际是否以明文 HTTP 提供服务（未配置证书时），决定 Cookie Secure、HSTS 等 */
  plainHttp: boolean;
  webDist: string;
  ollamaUrl: string;
  llmModel: string;
  ocrUrl: string;
  embedModel: string;
  modelDir: string;
  sessionTtlDays: number;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const devInsecure = env('CATALOGUE_DEV_INSECURE', '0') === '1';
  const base: Config = {
    dataDir: fromRoot(env('CATALOGUE_DATA_DIR', 'data')),
    host: env('CATALOGUE_HOST', '127.0.0.1'),
    port: Number(env('CATALOGUE_PORT', '8443')),
    tlsCert: process.env.CATALOGUE_TLS_CERT ? fromRoot(process.env.CATALOGUE_TLS_CERT) : null,
    tlsKey: process.env.CATALOGUE_TLS_KEY ? fromRoot(process.env.CATALOGUE_TLS_KEY) : null,
    devInsecure,
    allowHttp: env('CATALOGUE_ALLOW_HTTP', '0') === '1',
    plainHttp: false,
    webDist: fromRoot(env('CATALOGUE_WEB_DIST', 'apps/web/dist')),
    // Ollama / OCR 只允许本机地址，系统不调用任何外网 AI 服务
    ollamaUrl: env('CATALOGUE_OLLAMA_URL', 'http://127.0.0.1:11434'),
    llmModel: env('CATALOGUE_LLM_MODEL', 'qwen2.5:7b-instruct-q4_K_M'),
    ocrUrl: env('CATALOGUE_OCR_URL', 'http://127.0.0.1:8866'),
    embedModel: env('CATALOGUE_EMBED_MODEL', 'Xenova/bge-small-zh-v1.5'),
    modelDir: fromRoot(env('CATALOGUE_MODEL_DIR', 'models')),
    sessionTtlDays: Number(env('CATALOGUE_SESSION_TTL_DAYS', '14')),
  };
  const merged = { ...base, ...overrides };
  if (overrides.plainHttp === undefined) {
    merged.plainHttp = !(merged.tlsCert && merged.tlsKey) && (merged.devInsecure || merged.allowHttp);
  }
  return merged;
}
