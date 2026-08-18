import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';

const TOKEN_BYTES = 32; // 256 bits of entropy (>= 128 required)
const AES_ALGO = 'aes-256-gcm';

export function generateAccessToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashAccessToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function redactToken(token: string): string {
  if (token.length <= 8) {
    return '***';
  }
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

/**
 * Derive a 32-byte AES key from OUTBOX_ENCRYPTION_KEY.
 * Accepts a 64-char hex string or any passphrase (hashed).
 */
export function deriveOutboxKey(rawKey: string): Buffer {
  const trimmed = rawKey.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  return createHash('sha256').update(trimmed, 'utf8').digest();
}

export type EncryptedPublicPayload = {
  token: string;
  public_url: string;
};

export function encryptPublicPayload(
  payload: EncryptedPublicPayload,
  rawKey: string,
): string {
  return encryptBytes(Buffer.from(JSON.stringify(payload), 'utf8'), rawKey);
}

export function decryptPublicPayload(
  packed: string,
  rawKey: string,
): EncryptedPublicPayload {
  const decrypted = decryptBytes(packed, rawKey);
  return JSON.parse(decrypted.toString('utf8')) as EncryptedPublicPayload;
}

export function encryptBytes(plaintext: Buffer, rawKey: string): string {
  const key = deriveOutboxKey(rawKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv(AES_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function decryptBytes(packed: string, rawKey: string): Buffer {
  const [ivB64, tagB64, dataB64] = packed.split('.');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Invalid encrypted payload');
  }
  const key = deriveOutboxKey(rawKey);
  const decipher = createDecipheriv(
    AES_ALGO,
    key,
    Buffer.from(ivB64, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]);
}
