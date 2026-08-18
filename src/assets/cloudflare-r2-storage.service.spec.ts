import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { CloudflareR2StorageService } from './cloudflare-r2-storage.service';

jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({
      send: jest.fn(),
    })),
  };
});

describe('CloudflareR2StorageService', () => {
  function buildService(send: jest.Mock) {
    (S3Client as jest.Mock).mockImplementationOnce(() => ({ send }));
    return new CloudflareR2StorageService({
      getOrThrow: jest.fn((key: string) => {
        const values: Record<string, string> = {
          R2_ACCOUNT_ID: 'account',
          R2_BUCKET_NAME: 'bucket',
          R2_ACCESS_KEY_ID: 'access',
          R2_SECRET_ACCESS_KEY: 'secret',
        };
        return values[key];
      }),
      get: jest.fn((key: string) =>
        key === 'R2_SIGNED_URL_TTL_SECONDS' ? '300' : undefined,
      ),
    } as never);
  }

  it('streams private R2 objects through the backend for authorized public document links', async () => {
    async function* body() {
      yield Buffer.from('hello ');
      yield Buffer.from('world');
    }
    const send = jest.fn().mockResolvedValue({ Body: body() });
    const service = buildService(send);

    await expect(
      service.readObject({ key: 'contractor/assets/file.pdf' }),
    ).resolves.toEqual(Buffer.from('hello world'));

    expect(send).toHaveBeenCalledWith(expect.any(GetObjectCommand));
  });
});
