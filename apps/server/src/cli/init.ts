import readline from 'node:readline';
import { Writable } from 'node:stream';
import { loadConfig } from '../config';
import { createKeystore, deriveKeys, readKeystore } from '../crypto/keys';
import { openDatabase, seedCategories } from '../db';
import { createUser, validatePassword } from '../auth/users';
import { writeAudit } from '../modules/audit/audit';

/**
 * 首次初始化：设置主口令、创建加密数据库、创建藏家本人的超级管理员账号。
 * 非交互模式：设置 CATALOGUE_INIT_PASSPHRASE / CATALOGUE_INIT_USERNAME / CATALOGUE_INIT_PASSWORD。
 */
const config = loadConfig();

let muted = false;
const output = new Writable({
  write(chunk, _enc, cb) {
    if (!muted) process.stdout.write(chunk);
    cb();
  },
});
const rl = readline.createInterface({ input: process.stdin, output, terminal: true });

function ask(q: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(q);
    muted = hidden;
    rl.question('', (answer) => {
      muted = false;
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

async function askTwice(label: string, validate: (s: string) => string | null): Promise<string> {
  for (;;) {
    const a = await ask(`${label}：`, true);
    const err = validate(a);
    if (err) {
      console.log(`  ✗ ${err}`);
      continue;
    }
    if ((await ask(`再次输入${label}：`, true)) === a) return a;
    console.log('  ✗ 两次输入不一致');
  }
}

async function main() {
  if (readKeystore(config.dataDir)) {
    console.error(`数据目录 ${config.dataDir} 已经初始化过。如需重新初始化，请先手动备份并移走该目录。`);
    process.exit(1);
  }

  console.log('\n藏册 Catalogue · 首次初始化');
  console.log(`数据目录：${config.dataDir}\n`);
  console.log('【重要】主口令用于加密全部数据库和档案文件，服务商不保存、无法找回。');
  console.log('        请务必线下妥善保管；遗失主口令将导致数据永久无法解密。\n');

  // 本机开发模式允许简单口令和密码，正式部署仍强制复杂度
  const relaxed = config.devInsecure;
  if (relaxed) console.log('（开发模式：已放宽主口令与密码复杂度要求，正式部署前请勿使用）\n');
  const checkPassphrase = (s: string) => (relaxed ? (s ? null : '主口令不能为空') : s.length < 12 ? '主口令至少 12 位' : null);
  const checkPassword = (s: string) => validatePassword(s, relaxed);

  const env = process.env;
  const passphrase = env.CATALOGUE_INIT_PASSPHRASE ?? (await askTwice('主口令', checkPassphrase));
  const username = env.CATALOGUE_INIT_USERNAME ?? ((await ask('藏家账号用户名 [owner]：')) || 'owner');
  const password = env.CATALOGUE_INIT_PASSWORD ?? (await askTwice('藏家账号登录密码', checkPassword));
  rl.close();

  const ppErr = checkPassphrase(passphrase);
  if (ppErr) throw new Error(ppErr);
  const pwErr = checkPassword(password);
  if (pwErr) throw new Error(pwErr);

  console.log('\n正在派生密钥并创建加密数据库……');
  const ks = createKeystore(config.dataDir);
  const keys = deriveKeys(passphrase, ks);
  const db = openDatabase(config.dataDir, keys.dbKey);
  seedCategories(db);
  const owner = await createUser(db, { username, displayName: '藏家本人', password, role: 'owner' });
  writeAudit(db, { userId: owner.id, username: owner.username, action: 'system.init' });
  db.close();

  console.log(`\n✓ 初始化完成。超级管理员账号：${username}`);
  console.log('  启动服务：npm run start -w @catalogue/server（启动后在网页上输入主口令解锁）');
}

main().catch((e) => {
  console.error(`初始化失败：${(e as Error).message}`);
  process.exit(1);
});
