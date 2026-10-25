import crypto from 'node:crypto';

/**
 * AES-256-GCM 封装格式：[1 字节版本][12 字节 IV][16 字节 Tag][密文]
 */
const VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = 1 + IV_LEN + TAG_LEN;

export function seal(key: Buffer, plaintext: Buffer, aad?: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]);
}

export function open(key: Buffer, sealed: Buffer, aad?: Buffer): Buffer {
  if (sealed.length < HEADER_LEN || sealed[0] !== VERSION) throw new Error('无法识别的加密数据格式');
  const iv = sealed.subarray(1, 1 + IV_LEN);
  const tag = sealed.subarray(1 + IV_LEN, HEADER_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(sealed.subarray(HEADER_LEN)), decipher.final()]);
}

/** 信封加密：每个文件独立的数据密钥，由 fileKey 包裹后入库 */
export function encryptFile(fileKey: Buffer, plaintext: Buffer, fileId: string) {
  const dataKey = crypto.randomBytes(32);
  const aad = Buffer.from(fileId);
  const ciphertext = seal(dataKey, plaintext, aad);
  const wrappedKey = seal(fileKey, dataKey, aad);
  dataKey.fill(0);
  return { ciphertext, wrappedKey };
}

export function decryptFile(fileKey: Buffer, ciphertext: Buffer, wrappedKey: Buffer, fileId: string): Buffer {
  const aad = Buffer.from(fileId);
  const dataKey = open(fileKey, wrappedKey, aad);
  try {
    return open(dataKey, ciphertext, aad);
  } finally {
    dataKey.fill(0);
  }
}
