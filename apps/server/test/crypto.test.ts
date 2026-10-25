import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decryptFile, encryptFile, open, seal } from '../src/crypto/fileCrypto';
import { createKeystore, deriveKeys } from '../src/crypto/keys';
import { openDatabase } from '../src/db';
import { writeAudit } from '../src/modules/audit/audit';
import { FileStore } from '../src/storage/fileStore';
import { tmpDir } from './helpers';

const key = () => crypto.randomBytes(32);

describe('AES-256-GCM', () => {
  it('加密解密往返', () => {
    const k = key();
    const msg = Buffer.from('鉴定报告：清乾隆 粉彩瓷瓶');
    expect(open(k, seal(k, msg)).equals(msg)).toBe(true);
  });

  it('密文被篡改时校验失败', () => {
    const k = key();
    const sealed = seal(k, Buffer.from('hello world'));
    sealed[sealed.length - 1] ^= 0xff;
    expect(() => open(k, sealed)).toThrow();
  });

  it('错误密钥无法解密', () => {
    expect(() => open(key(), seal(key(), Buffer.from('x')))).toThrow();
  });

  it('信封加密绑定文件 ID，换 ID 无法解密', () => {
    const fk = key();
    const { ciphertext, wrappedKey } = encryptFile(fk, Buffer.from('pdf bytes'), 'file-a');
    expect(decryptFile(fk, ciphertext, wrappedKey, 'file-a').toString()).toBe('pdf bytes');
    expect(() => decryptFile(fk, ciphertext, wrappedKey, 'file-b')).toThrow();
  });
});

describe('密钥派生与文件仓库', () => {
  it('同一口令派生出相同密钥，不同口令不同', () => {
    const ks = createKeystore(tmpDir(), { N: 2 ** 10 });
    expect(deriveKeys('abc-passphrase', ks).dbKey).toBe(deriveKeys('abc-passphrase', ks).dbKey);
    expect(deriveKeys('abc-passphrase', ks).dbKey).not.toBe(deriveKeys('abd-passphrase', ks).dbKey);
  });

  it('落盘文件不含明文', () => {
    const dir = tmpDir();
    const store = new FileStore(dir, key());
    const secret = Buffer.from('CERTIFICATE-NO-998877 翡翠手镯');
    const { storageKey, wrappedKey } = store.put(secret);
    const onDisk = fs.readFileSync(path.join(dir, storageKey.slice(0, 2), storageKey));
    expect(onDisk.includes(secret)).toBe(false);
    expect(onDisk.includes(Buffer.from('CERTIFICATE'))).toBe(false);
    expect(store.get(storageKey, wrappedKey).equals(secret)).toBe(true);
  });
});

describe('SQLCipher 加密数据库', () => {
  it('错误口令无法打开，且文件中无明文', () => {
    const dir = tmpDir();
    const ks = createKeystore(dir, { N: 2 ** 10 });
    const db = openDatabase(dir, deriveKeys('right-passphrase', ks).dbKey);
    writeAudit(db, { action: 'secret-marker-action' });
    db.close();

    expect(() => openDatabase(dir, deriveKeys('wrong-passphrase', ks).dbKey)).toThrow(/主口令错误/);
    const raw = fs.readFileSync(path.join(dir, 'catalogue.db'));
    expect(raw.subarray(0, 16).toString('latin1')).not.toContain('SQLite format');
    expect(raw.includes(Buffer.from('secret-marker-action'))).toBe(false);

    const again = openDatabase(dir, deriveKeys('right-passphrase', ks).dbKey);
    expect(again.prepare('SELECT action FROM audit_logs').get()).toEqual({ action: 'secret-marker-action' });
    again.close();
  });

  it('审计日志只能追加，不能修改或删除', () => {
    const dir = tmpDir();
    const db = openDatabase(dir, deriveKeys('p-passphrase', createKeystore(dir, { N: 2 ** 10 })).dbKey);
    writeAudit(db, { action: 'item.create' });
    expect(() => db.prepare(`UPDATE audit_logs SET action = 'x'`).run()).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM audit_logs').run()).toThrow(/append-only/);
    db.close();
  });
});
