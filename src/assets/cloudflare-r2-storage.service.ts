import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import {
  AssetStorageService,
  PresignedUpload,
  StoredObjectMetadata,
} from './asset-storage.service';

@Injectable()
export class CloudflareR2StorageService extends AssetStorageService {
  readonly provider = 'cloudflare_r2' as const;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly ttlSeconds: number;

  constructor(private readonly configService: ConfigService) {
    super();
    const accountId = this.configService.getOrThrow<string>('R2_ACCOUNT_ID');
    this.bucket = this.configService.getOrThrow<string>('R2_BUCKET_NAME');
    this.ttlSeconds = Number(
      this.configService.get<string>('R2_SIGNED_URL_TTL_SECONDS') ?? 300,
    );
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: this.configService.getOrThrow<string>('R2_ACCESS_KEY_ID'),
        secretAccessKey: this.configService.getOrThrow<string>(
          'R2_SECRET_ACCESS_KEY',
        ),
      },
    });
  }

  createObjectKey(input: {
    organizationId: string;
    kind: string;
    filename: string;
  }) {
    const uploadPrefix =
      this.configService.get<string>('STORAGE_UPLOAD_PREFIX') ?? 'home-pro';
    const extension = safeExtension(input.filename);
    return [
      sanitizeSegment(uploadPrefix),
      'assets',
      input.organizationId,
      sanitizeSegment(input.kind),
      `${randomUUID()}${extension}`,
    ].join('/');
  }

  async putObject(input: {
    key: string;
    body: Buffer;
    mimeType: string;
    filename: string;
  }) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentLength: input.body.byteLength,
        ContentType: input.mimeType,
        ContentDisposition: contentDisposition(input.filename),
        CacheControl: 'private, max-age=0, no-store',
      }),
    );
  }

  async createPresignedPutUrl(input: {
    key: string;
    mimeType: string;
    size: number;
  }): Promise<PresignedUpload> {
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      ContentType: input.mimeType,
      ContentLength: input.size,
      CacheControl: 'private, max-age=0, no-store',
    });
    return {
      upload_url: await getSignedUrl(this.client, command, {
        expiresIn: this.ttlSeconds,
      }),
      required_headers: { 'Content-Type': input.mimeType },
      expires_at: expiresAt.toISOString(),
    };
  }

  async createSignedGetUrl(input: {
    key: string;
    filename: string;
    mimeType: string;
  }) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        ResponseContentType: input.mimeType,
        ResponseContentDisposition: contentDisposition(input.filename),
      }),
      { expiresIn: this.ttlSeconds },
    );
  }

  async readObject(input: { key: string }): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: input.key }),
    );
    if (!result.Body) {
      return Buffer.alloc(0);
    }
    const chunks: Buffer[] = [];
    for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async inspectObject(input: { key: string }): Promise<StoredObjectMetadata> {
    const result = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: input.key }),
    );
    return {
      size: result.ContentLength ?? 0,
      mime_type: result.ContentType ?? null,
      etag: result.ETag ?? null,
      checksum_sha256: result.ChecksumSHA256
        ? Buffer.from(result.ChecksumSHA256, 'base64').toString('hex')
        : null,
    };
  }

  async deleteObject(input: { key: string }) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: input.key }),
    );
  }
}

function safeExtension(filename: string) {
  const extension = extname(filename).toLowerCase();
  return /^[a-z0-9.]{1,12}$/.test(extension) ? extension : '';
}

function sanitizeSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function contentDisposition(filename: string) {
  const safeName = filename.replace(/["\r\n\\/]/g, '_').slice(0, 180);
  return `inline; filename="${safeName}"`;
}
