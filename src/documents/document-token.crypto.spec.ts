import {
  decryptPublicPayload,
  encryptPublicPayload,
  generateAccessToken,
  hashAccessToken,
  redactToken,
} from './document-token.crypto';

describe('document-token.crypto', () => {
  it('generates high-entropy tokens and stable hashes', () => {
    const token = generateAccessToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(hashAccessToken(token)).toHaveLength(64);
    expect(hashAccessToken(token)).toBe(hashAccessToken(token));
    expect(hashAccessToken(token)).not.toBe(hashAccessToken(`${token}x`));
  });

  it('redacts tokens for logs', () => {
    const token = 'abcdefghijklmnopqrstuvwxyz012345';
    expect(redactToken(token)).toBe('abcd…2345');
    expect(redactToken(token)).not.toContain('efghijklmn');
  });

  it('round-trips outbox public payload encryption', () => {
    const key = 'test-outbox-encryption-key-32b!!';
    const packed = encryptPublicPayload(
      {
        token: 'plain-token-value',
        public_url: 'http://127.0.0.1:3000/view/estimate/plain-token-value',
      },
      key,
    );
    expect(packed).not.toContain('plain-token-value');
    expect(decryptPublicPayload(packed, key)).toEqual({
      token: 'plain-token-value',
      public_url: 'http://127.0.0.1:3000/view/estimate/plain-token-value',
    });
  });
});
