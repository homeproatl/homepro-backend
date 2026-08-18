export type StoredObjectMetadata = {
  size: number;
  mime_type: string | null;
  etag?: string | null;
  checksum_sha256?: string | null;
};

export type PresignedUpload = {
  upload_url: string;
  required_headers: Record<string, string>;
  expires_at: string;
};

export abstract class AssetStorageService {
  abstract readonly provider: 'local' | 'cloudflare_r2';

  abstract createObjectKey(input: {
    organizationId: string;
    kind: string;
    filename: string;
  }): string;

  abstract putObject(input: {
    key: string;
    body: Buffer;
    mimeType: string;
    filename: string;
  }): Promise<void>;

  abstract createPresignedPutUrl(input: {
    key: string;
    mimeType: string;
    size: number;
  }): Promise<PresignedUpload>;

  abstract createSignedGetUrl(input: {
    key: string;
    filename: string;
    mimeType: string;
  }): Promise<string>;

  abstract readObject(input: { key: string }): Promise<Buffer>;

  abstract inspectObject(input: { key: string }): Promise<StoredObjectMetadata>;

  abstract deleteObject(input: { key: string }): Promise<void>;
}
