import path from 'node:path';
import type { Config } from './config';
import { deriveKeys, readKeystore } from './crypto/keys';
import { openDatabase, seedCategories, type DB } from './db';
import { FileStore } from './storage/fileStore';

export interface Vault {
  db: DB;
  files: FileStore;
}

type Listener = (vault: Vault | null) => void;

/**
 * 系统启动后默认处于锁定状态，藏家输入主口令后才解密数据库与文件。
 * 口令和派生密钥只保存在进程内存中。
 */
export class VaultManager {
  private vault: Vault | null = null;
  private listeners: Listener[] = [];

  constructor(private readonly config: Config) {}

  get initialized(): boolean {
    return readKeystore(this.config.dataDir) !== null;
  }

  get current(): Vault | null {
    return this.vault;
  }

  onChange(fn: Listener): void {
    this.listeners.push(fn);
  }

  unlock(passphrase: string): Vault {
    if (this.vault) return this.vault;
    const ks = readKeystore(this.config.dataDir);
    if (!ks) throw new Error('系统尚未初始化，请先运行 npm run init');
    const keys = deriveKeys(passphrase, ks);
    const db = openDatabase(this.config.dataDir, keys.dbKey);
    seedCategories(db);
    this.vault = { db, files: new FileStore(path.join(this.config.dataDir, 'files'), keys.fileKey) };
    this.listeners.forEach((fn) => fn(this.vault));
    return this.vault;
  }

  lock(): void {
    if (!this.vault) return;
    this.vault.db.close();
    this.vault = null;
    this.listeners.forEach((fn) => fn(null));
  }
}
