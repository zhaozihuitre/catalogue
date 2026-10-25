import fs from 'node:fs';
import cron from 'node-cron';
import { loadConfig } from './config';
import { buildApp } from './app';
import { VaultManager } from './vault';
import { createAiServices } from './ai/services';
import { AiWorker } from './ai/worker';
import { runReminderScan } from './modules/reminders/reminders';
import { writeAudit } from './modules/audit/audit';

const config = loadConfig();

let https: { cert: Buffer; key: Buffer } | null = null;
if (config.tlsCert && config.tlsKey) {
  https = { cert: fs.readFileSync(config.tlsCert), key: fs.readFileSync(config.tlsKey) };
} else if (config.allowHttp) {
  // 明确允许在内网用 HTTP：电脑、手机、电视直接打开网址即可，无需安装证书
  console.warn(
    `[警告] 正以 HTTP 在 ${config.host}:${config.port} 提供服务，同一网络内的流量未加密。` +
      '仅适用于可信的家庭内网或 Tailscale；云服务器部署必须配置 HTTPS。',
  );
} else if (config.devInsecure) {
  // 开发模式只允许本机回环地址，防止明文 HTTP 暴露到局域网
  config.host = '127.0.0.1';
} else {
  console.error(
    '未配置 HTTPS 证书。请设置 CATALOGUE_TLS_CERT / CATALOGUE_TLS_KEY（可用 deploy/gen-certs.sh 生成），\n' +
      '或在可信内网中设置 CATALOGUE_ALLOW_HTTP=1 以 HTTP 提供服务；本机开发调试可设置 CATALOGUE_DEV_INSECURE=1。',
  );
  process.exit(1);
}

const vaults = new VaultManager(config);
const ai = createAiServices(config);
const app = await buildApp({ config, vaults, ai }, https ? { https } as never : {});
const worker = new AiWorker(ai, app.log);

async function scanReminders() {
  const v = vaults.current;
  if (!v) return;
  try {
    const created = await runReminderScan(v.db);
    if (created.length) writeAudit(v.db, { action: 'reminder.scan', detail: { created: created.length } });
  } catch (e) {
    app.log.error(e, 'reminder scan failed');
  }
}

vaults.onChange((v) => {
  if (v) {
    worker.start(v);
    void scanReminders();
  } else {
    worker.stop();
  }
});

cron.schedule('0 8 * * *', scanReminders);

// 运维或自动启动场景：可通过环境变量直接解锁（口令仍只存在于进程内存中）
if (process.env.CATALOGUE_PASSPHRASE) {
  try {
    vaults.unlock(process.env.CATALOGUE_PASSPHRASE);
    app.log.info('vault unlocked from environment');
  } catch (e) {
    app.log.error((e as Error).message);
  }
  delete process.env.CATALOGUE_PASSPHRASE;
}

if (!vaults.initialized) app.log.warn('系统尚未初始化，请先运行 npm run init');

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    worker.stop();
    vaults.lock();
    await app.close();
    process.exit(0);
  });
}

await app.listen({ host: config.host, port: config.port });
