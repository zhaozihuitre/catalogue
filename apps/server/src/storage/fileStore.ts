import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { decryptFile, encryptFile } from '../crypto/fileCrypto';

/**
 * 加密文件仓库。落盘文件名为随机 UUID，与原文件名、藏品无任何可见关联。
 */
export class FileStore {
  constructor(
    private readonly root: string,
    private readonly fileKey: Buffer,
  ) {
    fs.mkdirSync(root, { recursive: true });
  }

  private pathFor(storageKey: string): string {
    if (!/^[0-9a-f-]{36}$/.test(storageKey)) throw new Error('非法存储键');
    return path.join(this.root, storageKey.slice(0, 2), storageKey);
  }

  put(plaintext: Buffer): { storageKey: string; wrappedKey: Buffer } {
    const storageKey = crypto.randomUUID();
    const { ciphertext, wrappedKey } = encryptFile(this.fileKey, plaintext, storageKey);
    const p = this.pathFor(storageKey);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, ciphertext, { mode: 0o600 });
    return { storageKey, wrappedKey };
  }

  get(storageKey: string, wrappedKey: Buffer): Buffer {
    return decryptFile(this.fileKey, fs.readFileSync(this.pathFor(storageKey)), wrappedKey, storageKey);
  }

  remove(storageKey: string): void {
    fs.rmSync(this.pathFor(storageKey), { force: true });
  }
}
