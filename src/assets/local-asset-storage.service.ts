import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'fs/promises';
import { extname, join, normalize } from 'path';
import {
  AssetStorageService,
  PresignedUpload,
  StoredObjectMetadata,
} from './asset-storage.service';

@Injectable()
export class LocalAssetStorageService extends AssetStorageService {
  readonly provider = 'local' as const;

  constructor(private readonly configService: ConfigService) {
    super();
  }

  createObjectKey(input: {
    organizationId: string;
    kind: string;
    filename: string;
  }) {
    const extension = safeExtension(input.filename);
    return [
      'assets',
      input.organizationId,
      input.kind,
      `${randomUUID()}${extension}`,
    ].join('/');
  }

  async putObject(input: {
    key: string;
    body: Buffer;
    mimeType: string;
    filename: string;
  }) {
    const path = this.resolvePath(input.key);
    await mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
    await writeFile(path, input.body);
  }

  async createPresignedPutUrl(): Promise<PresignedUpload> {
    throw new Error('Direct upload sessions require Cloudflare R2 storage.');
  }

  async createSignedGetUrl(input: {
    key: string;
    filename: string;
    mimeType: string;
  }) {
    return `/assets/${encodeURIComponent(input.key)}/content`;
  }

  async readObject(input: { key: string }) {
    return readFile(this.resolvePath(input.key));
  }

  async inspectObject(input: { key: string }): Promise<StoredObjectMetadata> {
    const stats = await stat(this.resolvePath(input.key));
    return {
      size: stats.size,
      mime_type: null,
      etag: null,
      checksum_sha256: null,
    };
  }

  async deleteObject(input: { key: string }) {
    await rm(this.resolvePath(input.key), { force: true });
  }

  private resolvePath(key: string) {
    const root =
      this.configService.get<string>('ASSET_LOCAL_STORAGE_DIR') ??
      '.local-assets';
    const resolved = normalize(join(process.cwd(), root, key));
    const safeRoot = normalize(join(process.cwd(), root));
    if (!resolved.startsWith(safeRoot)) {
      throw new Error('Invalid local asset key');
    }
    return resolved;
  }
}

function safeExtension(filename: string) {
  const extension = extname(filename).toLowerCase();
  return /^[a-z0-9.]{1,12}$/.test(extension) ? extension : '';
}
