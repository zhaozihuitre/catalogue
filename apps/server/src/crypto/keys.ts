import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * keystore.json 只保存 KDF 参数和盐，不保存任何密钥或口令。
 * 口令只存在于进程内存中，服务商不持有。
 */
export interface Keystore {
  version: 1;
  kdf: 'scrypt';
  salt: string;
  N: number;
  r: number;
  p: number;
  createdAt: string;
}

export interface DerivedKeys {
  /** SQLCipher 整库加密密钥（hex） */
  dbKey: string;
  /** 文件信封加密的密钥包裹密钥 */
  fileKey: Buffer;
}

const KEYSTORE_FILE = 'keystore.json';

export function keystorePath(dataDir: string): string {
  return path.join(dataDir, KEYSTORE_FILE);
}

export function readKeystore(dataDir: string): Keystore | null {
  const p = keystorePath(dataDir);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8')) as Keystore;
}

export function createKeystore(dataDir: string, cost: Partial<Pick<Keystore, 'N' | 'r' | 'p'>> = {}): Keystore {
  const ks: Keystore = {
    version: 1,
    kdf: 'scrypt',
    salt: crypto.randomBytes(32).toString('base64'),
    N: cost.N ?? 2 ** 17,
    r: cost.r ?? 8,
    p: cost.p ?? 1,
    createdAt: new Date().toISOString(),
  };
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(keystorePath(dataDir), JSON.stringify(ks, null, 2), { mode: 0o600 });
  return ks;
}

export function deriveKeys(passphrase: string, ks: Keystore): DerivedKeys {
  if (!passphrase) throw new Error('主口令不能为空');
  const master = crypto.scryptSync(passphrase.normalize('NFKC'), Buffer.from(ks.salt, 'base64'), 32, {
    N: ks.N,
    r: ks.r,
    p: ks.p,
    maxmem: 256 * ks.N * ks.r,
  });
  const hkdf = (info: string) => Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), info, 32));
  const dbKey = hkdf('catalogue/db/v1').toString('hex');
  const fileKey = hkdf('catalogue/file/v1');
  master.fill(0);
  return { dbKey, fileKey };
}
