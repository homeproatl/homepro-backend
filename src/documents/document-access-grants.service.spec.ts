import { generateAccessToken, hashAccessToken } from './document-token.crypto';
import { DocumentAccessGrantsService } from './document-access-grants.service';

describe('DocumentAccessGrantsService', () => {
  it('stores only hashed tokens and revokes prior grants on rotate', async () => {
    const updates: unknown[] = [];
    const created: unknown[] = [];
    const model = {
      updateMany: jest.fn().mockReturnValue({
        exec: jest.fn().mockImplementation(async () => {
          updates.push('revoke');
          return { modifiedCount: 1 };
        }),
      }),
      create: jest
        .fn()
        .mockImplementation(async (doc: Record<string, unknown>) => {
          created.push(doc);
          return { ...doc, _id: 'grant-1' };
        }),
      findOne: jest.fn(),
    };

    const service = new DocumentAccessGrantsService(model as never);
    const { token, grant } = await service.rotateGrant({
      organizationId: '507f1f77bcf86cd799439011',
      documentId: '507f1f77bcf86cd799439012',
      createdByUserId: '507f1f77bcf86cd799439013',
    });

    expect(updates.length).toBeGreaterThanOrEqual(1);
    expect(token).toBeTruthy();
    expect(grant.token_hash).toBe(hashAccessToken(token));
    expect(JSON.stringify(created)).not.toContain(token);
    expect(generateAccessToken()).not.toBe(token);
  });

  it('returns generic invalid for missing or revoked grants', async () => {
    const model = {
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      }),
    };
    const service = new DocumentAccessGrantsService(model as never);
    await expect(service.findValidGrantByToken('missing')).rejects.toThrow(
      /Invalid or expired link/,
    );
  });
});
