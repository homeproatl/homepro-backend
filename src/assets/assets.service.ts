import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Model, Types } from 'mongoose';
import {
  AuditLog,
  AuditLogDocument,
} from '../audit-logs/schemas/audit-log.schema';
import { Client, ClientDocument } from '../clients/schemas/client.schema';
import { asObjectId } from '../common/utils/object-id';
import { withOrganizationScope } from '../common/utils/organization-scope';
import {
  AppSettings,
  AppSettingsDocument,
} from '../settings/schemas/app-settings.schema';
import {
  OrgDocument,
  OrgDocumentDocument,
} from '../documents/schemas/document.schema';
import { AssetStorageService } from './asset-storage.service';
import { CreateAssetDirectSessionDto } from './dto/create-asset-direct-session.dto';
import { CreateAssetUploadDto } from './dto/create-asset-upload.dto';
import {
  Asset,
  AssetDocument,
  AssetKind,
  AssetOwnerType,
} from './schemas/asset.schema';

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ATTACHMENT_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const FIXED_ASSET_SIZE_LIMIT_BYTES: Record<AssetKind, number> = {
  logo: 5 * 1024 * 1024,
  photo: 10 * 1024 * 1024,
  attachment: 10 * 1024 * 1024,
  signature: 2 * 1024 * 1024,
};
const DOCUMENT_PHOTO_LIMIT = 20;
const DOCUMENT_ATTACHMENT_LIMIT = 10;
const LINE_PHOTO_LIMIT = 4;

@Injectable()
export class AssetsService {
  constructor(
    @InjectModel(Asset.name) private readonly assetModel: Model<AssetDocument>,
    @InjectModel(Client.name)
    private readonly clientModel: Model<ClientDocument>,
    @InjectModel(OrgDocument.name)
    private readonly documentModel: Model<OrgDocumentDocument>,
    @InjectModel(AppSettings.name)
    private readonly appSettingsModel: Model<AppSettingsDocument>,
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
    private readonly storage: AssetStorageService,
  ) {}

  async cloneDocumentAssets(
    source: OrgDocumentDocument,
    target: OrgDocumentDocument,
    actorUserId: string,
  ) {
    const organizationId = String(source.organization_id);
    const targetLineIds = target.line_items.map((line) => String(line._id));
    const copies: Array<{
      sourceAssetId: Types.ObjectId;
      ownerType: 'document' | 'line_item';
      ownerId: string;
    }> = [];

    for (const assetId of source.document_photo_asset_ids ?? []) {
      copies.push({
        sourceAssetId: assetId,
        ownerType: 'document',
        ownerId: String(target._id),
      });
    }
    for (const assetId of source.attachment_asset_ids ?? []) {
      copies.push({
        sourceAssetId: assetId,
        ownerType: 'document',
        ownerId: String(target._id),
      });
    }
    source.line_items.forEach((line, index) => {
      const targetLineId = targetLineIds[index];
      if (!targetLineId) {
        return;
      }
      for (const assetId of line.photo_asset_ids ?? []) {
        copies.push({
          sourceAssetId: assetId,
          ownerType: 'line_item',
          ownerId: targetLineId,
        });
      }
    });

    for (const copy of copies) {
      await this.cloneAsset(
        copy,
        organizationId,
        actorUserId,
        String(target._id),
      );
    }
  }

  private async cloneAsset(
    input: {
      sourceAssetId: Types.ObjectId;
      ownerType: 'document' | 'line_item';
      ownerId: string;
    },
    organizationId: string,
    actorUserId: string,
    targetDocumentId: string,
  ) {
    const cloneSourceId = `${targetDocumentId}:${String(input.sourceAssetId)}`;
    const existing = await this.assetModel
      .findOne({
        organization_id: asObjectId(organizationId, 'organization id'),
        'source_metadata.source_system': 'internal',
        'source_metadata.source_entity': 'invoice_asset_clone',
        'source_metadata.source_id': cloneSourceId,
        is_deleted: false,
      })
      .exec();
    if (existing) {
      await this.attachAsset(existing);
      return;
    }

    const source = await this.assetModel
      .findOne({
        _id: input.sourceAssetId,
        organization_id: asObjectId(organizationId, 'organization id'),
        status: 'ready',
        is_deleted: false,
      })
      .exec();
    if (!source) {
      throw new NotFoundException(
        `Source asset ${String(input.sourceAssetId)} is not available.`,
      );
    }

    const body = await this.storage.readObject({ key: source.storage_key });
    const storageKey = this.storage.createObjectKey({
      organizationId,
      kind: source.kind,
      filename: source.filename,
    });
    await this.storage.putObject({
      key: storageKey,
      body,
      mimeType: source.mime_type,
      filename: source.filename,
    });

    try {
      const clone = await this.assetModel.create({
        organization_id: source.organization_id,
        owner_type: input.ownerType,
        owner_id: asObjectId(input.ownerId, 'asset owner id'),
        kind: source.kind,
        filename: source.filename,
        mime_type: source.mime_type,
        size: source.size,
        storage_provider: this.storage.provider,
        storage_key: storageKey,
        checksum_sha256: source.checksum_sha256,
        caption: source.caption,
        sort_order: source.sort_order,
        width: source.width,
        height: source.height,
        status: 'ready',
        is_deleted: false,
        source_metadata: {
          source_system: 'internal',
          source_account_id: organizationId,
          source_entity: 'invoice_asset_clone',
          source_id: cloneSourceId,
          source_created_at: source.created_at,
          source_updated_at: source.updated_at,
        },
        created_by_user_id: asObjectId(actorUserId, 'actor user id'),
      });
      await this.attachAsset(clone);
    } catch (error) {
      await this.storage.deleteObject({ key: storageKey });
      throw error;
    }
  }

  async createFromMultipart(
    payload: CreateAssetUploadDto,
    file: Express.Multer.File | undefined,
    organizationId: string,
    actorUserId: string,
  ) {
    if (!file) {
      throw new BadRequestException('File is required.');
    }
    const normalized = this.normalizePayload(payload);
    normalized.size = file.size;
    await this.assertOwner(
      normalized.owner_type,
      normalized.owner_id,
      organizationId,
    );
    await this.assertOwnerCapacity(
      normalized.owner_type,
      normalized.owner_id,
      normalized.kind,
      organizationId,
    );
    this.assertKindAllowed(
      normalized.kind,
      normalized.owner_type,
      normalized.mime_type,
    );
    this.assertSize(normalized.kind, normalized.size);
    this.assertMagicBytes(file.buffer, normalized.mime_type);

    const storageKey = this.storage.createObjectKey({
      organizationId,
      kind: normalized.kind,
      filename: normalized.filename,
    });
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    await this.storage.putObject({
      key: storageKey,
      body: file.buffer,
      mimeType: normalized.mime_type,
      filename: normalized.filename,
    });
    const asset = await this.assetModel.create({
      organization_id: asObjectId(organizationId, 'organization id'),
      owner_type: normalized.owner_type,
      owner_id: asObjectId(normalized.owner_id, 'owner id'),
      kind: normalized.kind,
      filename: normalized.filename,
      mime_type: normalized.mime_type,
      size: normalized.size,
      storage_provider: this.storage.provider,
      storage_key: storageKey,
      checksum_sha256: checksum,
      width: null,
      height: null,
      status: 'ready',
      is_deleted: false,
      created_by_user_id: asObjectId(actorUserId, 'actor user id'),
    });
    await this.attachAsset(asset);
    await this.audit(asset, actorUserId, 'create');
    return this.serialize(asset);
  }

  async createDirectSession(
    payload: CreateAssetDirectSessionDto,
    organizationId: string,
    actorUserId: string,
  ) {
    if (this.storage.provider !== 'cloudflare_r2') {
      throw new BadRequestException(
        'Direct upload sessions require Cloudflare R2 storage.',
      );
    }
    const normalized = this.normalizePayload(payload);
    await this.assertOwner(
      normalized.owner_type,
      normalized.owner_id,
      organizationId,
    );
    await this.assertOwnerCapacity(
      normalized.owner_type,
      normalized.owner_id,
      normalized.kind,
      organizationId,
    );
    this.assertKindAllowed(
      normalized.kind,
      normalized.owner_type,
      normalized.mime_type,
    );
    this.assertSize(normalized.kind, normalized.size);
    const storageKey = this.storage.createObjectKey({
      organizationId,
      kind: normalized.kind,
      filename: normalized.filename,
    });
    const asset = await this.assetModel.create({
      organization_id: asObjectId(organizationId, 'organization id'),
      owner_type: normalized.owner_type,
      owner_id: asObjectId(normalized.owner_id, 'owner id'),
      kind: normalized.kind,
      filename: normalized.filename,
      mime_type: normalized.mime_type,
      size: normalized.size,
      storage_provider: this.storage.provider,
      storage_key: storageKey,
      checksum_sha256: normalized.checksum_sha256 ?? null,
      width: null,
      height: null,
      status: 'pending',
      is_deleted: false,
      created_by_user_id: asObjectId(actorUserId, 'actor user id'),
    });
    const session = await this.storage.createPresignedPutUrl({
      key: storageKey,
      mimeType: normalized.mime_type,
      size: normalized.size,
    });
    await this.audit(asset, actorUserId, 'direct_session_create');
    return {
      asset: this.serialize(asset),
      asset_id: String(asset._id),
      ...session,
    };
  }

  async confirmDirectSession(
    assetId: string,
    organizationId: string,
    actorUserId: string,
  ) {
    const asset = await this.requireAsset(assetId, organizationId);
    if (asset.status !== 'pending') {
      return this.serialize(asset);
    }
    const metadata = await this.storage.inspectObject({
      key: asset.storage_key,
    });
    if (metadata.size !== asset.size) {
      throw new BadRequestException(
        'Uploaded file size does not match session.',
      );
    }
    if (metadata.mime_type && metadata.mime_type !== asset.mime_type) {
      throw new BadRequestException(
        'Uploaded file type does not match session.',
      );
    }
    if (
      asset.checksum_sha256 &&
      metadata.checksum_sha256 &&
      metadata.checksum_sha256 !== asset.checksum_sha256
    ) {
      throw new BadRequestException(
        'Uploaded file checksum does not match session.',
      );
    }
    await this.assetModel.updateOne(
      { _id: asset._id },
      { $set: { status: 'ready' } },
    );
    const updated = await this.requireAsset(assetId, organizationId);
    await this.attachAsset(updated);
    await this.audit(updated, actorUserId, 'direct_session_confirm');
    return this.serialize(updated);
  }

  async getAccess(assetId: string, organizationId: string) {
    const asset = await this.requireReadyAsset(assetId, organizationId);
    if (this.storage.provider === 'local') {
      return {
        url: `/assets/${encodeURIComponent(assetId)}/content`,
        expires_in_seconds: 300,
      };
    }
    return {
      url: await this.storage.createSignedGetUrl({
        key: asset.storage_key,
        filename: asset.filename,
        mimeType: asset.mime_type,
      }),
      expires_in_seconds: 300,
    };
  }

  async readLocalContent(assetId: string, organizationId: string) {
    const asset = await this.requireReadyAsset(assetId, organizationId);
    if (this.storage.provider !== 'local') {
      throw new BadRequestException(
        'Content streaming is only for local storage.',
      );
    }
    return {
      asset: this.serialize(asset),
      buffer: await this.storage.readObject({ key: asset.storage_key }),
    };
  }

  async remove(assetId: string, organizationId: string, actorUserId: string) {
    const asset = await this.requireAsset(assetId, organizationId);
    await this.detachAsset(asset);
    await this.assetModel.updateOne(
      { _id: asset._id },
      { $set: { is_deleted: true } },
    );
    await this.storage
      .deleteObject({ key: asset.storage_key })
      .catch(() => undefined);
    await this.audit(asset, actorUserId, 'delete');
    return { ok: true };
  }

  private normalizePayload<T extends CreateAssetDirectSessionDto>(payload: T) {
    return {
      owner_type: payload.owner_type,
      owner_id: payload.owner_id,
      kind: payload.kind,
      filename: payload.filename
        .trim()
        .replace(/[\r\n\\/]/g, '_')
        .slice(0, 240),
      mime_type: payload.mime_type.trim().toLowerCase(),
      size: payload.size,
      checksum_sha256: payload.checksum_sha256?.trim() || null,
    };
  }

  private assertKindAllowed(
    kind: AssetKind,
    ownerType: AssetOwnerType,
    mimeType: string,
  ) {
    if (kind === 'logo' && ownerType !== 'organization') {
      throw new BadRequestException(
        'Logo assets must belong to the organization.',
      );
    }
    if (kind === 'signature' && ownerType !== 'document') {
      throw new BadRequestException(
        'Signature assets must belong to a document.',
      );
    }
    const allowed =
      kind === 'attachment' ? ATTACHMENT_MIME_TYPES : IMAGE_MIME_TYPES;
    if (!allowed.has(mimeType)) {
      throw new BadRequestException(`Unsupported ${kind} file type.`);
    }
  }

  private assertSize(kind: AssetKind, size: number) {
    const max = FIXED_ASSET_SIZE_LIMIT_BYTES[kind];
    if (size > max) {
      throw new BadRequestException(
        `${kind} exceeds the configured size limit.`,
      );
    }
  }

  private assertMagicBytes(buffer: Buffer, mimeType: string) {
    if (mimeType === 'application/pdf') {
      if (buffer.subarray(0, 4).toString('utf8') !== '%PDF') {
        throw new BadRequestException(
          'PDF signature does not match file type.',
        );
      }
      return;
    }
    if (mimeType === 'image/png') {
      if (
        !buffer
          .subarray(0, 8)
          .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      ) {
        throw new BadRequestException(
          'PNG signature does not match file type.',
        );
      }
      return;
    }
    if (mimeType === 'image/jpeg') {
      if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
        throw new BadRequestException(
          'JPEG signature does not match file type.',
        );
      }
      return;
    }
    if (mimeType === 'image/webp') {
      if (
        buffer.subarray(0, 4).toString('ascii') !== 'RIFF' ||
        buffer.subarray(8, 12).toString('ascii') !== 'WEBP'
      ) {
        throw new BadRequestException(
          'WebP signature does not match file type.',
        );
      }
    }
  }

  private async assertOwner(
    ownerType: AssetOwnerType,
    ownerId: string,
    organizationId: string,
  ) {
    if (ownerType === 'organization') {
      if (ownerId !== organizationId) {
        throw new ForbiddenException('Asset owner is outside this company.');
      }
      return;
    }
    if (ownerType === 'client') {
      const count = await this.clientModel
        .countDocuments(
          withOrganizationScope(organizationId, { _id: asObjectId(ownerId) }),
        )
        .exec();
      if (count < 1) throw new NotFoundException('Client not found.');
      return;
    }
    if (ownerType === 'document') {
      const count = await this.documentModel
        .countDocuments(
          withOrganizationScope(organizationId, { _id: asObjectId(ownerId) }),
        )
        .exec();
      if (count < 1) throw new NotFoundException('Document not found.');
      return;
    }
    const count = await this.documentModel
      .countDocuments(
        withOrganizationScope(organizationId, {
          'line_items._id': asObjectId(ownerId, 'line item id'),
        }),
      )
      .exec();
    if (count < 1) throw new NotFoundException('Line item not found.');
  }

  private async assertOwnerCapacity(
    ownerType: AssetOwnerType,
    ownerId: string,
    kind: AssetKind,
    organizationId: string,
  ) {
    if (ownerType === 'document') {
      const doc = await this.documentModel
        .findOne(
          withOrganizationScope(organizationId, {
            _id: asObjectId(ownerId, 'document id'),
          }),
        )
        .select('document_photo_asset_ids attachment_asset_ids')
        .lean()
        .exec();
      if (!doc) throw new NotFoundException('Document not found.');
      if (
        kind === 'photo' &&
        (doc.document_photo_asset_ids?.length ?? 0) >= DOCUMENT_PHOTO_LIMIT
      ) {
        throw new BadRequestException(
          `Document photos are limited to ${DOCUMENT_PHOTO_LIMIT}.`,
        );
      }
      if (
        kind === 'attachment' &&
        (doc.attachment_asset_ids?.length ?? 0) >= DOCUMENT_ATTACHMENT_LIMIT
      ) {
        throw new BadRequestException(
          `Document attachments are limited to ${DOCUMENT_ATTACHMENT_LIMIT}.`,
        );
      }
      return;
    }
    if (ownerType === 'line_item') {
      if (kind !== 'photo') {
        return;
      }
      const doc = await this.documentModel
        .findOne(
          withOrganizationScope(organizationId, {
            'line_items._id': asObjectId(ownerId, 'line item id'),
          }),
        )
        .select('line_items._id line_items.photo_asset_ids')
        .lean()
        .exec();
      const line = doc?.line_items?.find(
        (entry) => String(entry._id) === String(ownerId),
      );
      if (!line) throw new NotFoundException('Line item not found.');
      if ((line.photo_asset_ids?.length ?? 0) >= LINE_PHOTO_LIMIT) {
        throw new BadRequestException(
          `Line photos are limited to ${LINE_PHOTO_LIMIT}.`,
        );
      }
    }
  }

  private async attachAsset(asset: AssetDocument) {
    if (asset.kind === 'logo' && asset.owner_type === 'organization') {
      await this.appSettingsModel.updateOne(
        { organization_id: asset.organization_id },
        { $set: { 'company.logo_asset_id': String(asset._id) } },
      );
    }
    if (asset.owner_type === 'document') {
      const path =
        asset.kind === 'attachment'
          ? 'attachment_asset_ids'
          : 'document_photo_asset_ids';
      await this.documentModel.updateOne(
        withOrganizationScope(String(asset.organization_id), {
          _id: asset.owner_id,
        }),
        { $addToSet: { [path]: asset._id } },
      );
    }
    if (asset.owner_type === 'line_item') {
      await this.documentModel.updateOne(
        withOrganizationScope(String(asset.organization_id), {
          'line_items._id': asset.owner_id,
        }),
        { $addToSet: { 'line_items.$.photo_asset_ids': asset._id } },
      );
    }
  }

  private async detachAsset(asset: AssetDocument) {
    if (asset.kind === 'logo' && asset.owner_type === 'organization') {
      await this.appSettingsModel.updateOne(
        {
          organization_id: asset.organization_id,
          'company.logo_asset_id': String(asset._id),
        },
        { $set: { 'company.logo_asset_id': null } },
      );
    }
    await this.documentModel.updateMany(
      { organization_id: asset.organization_id },
      {
        $pull: {
          document_photo_asset_ids: asset._id,
          attachment_asset_ids: asset._id,
          'line_items.$[].photo_asset_ids': asset._id,
        },
      },
    );
  }

  private async requireReadyAsset(assetId: string, organizationId: string) {
    const asset = await this.requireAsset(assetId, organizationId);
    if (asset.status !== 'ready' || asset.is_deleted) {
      throw new NotFoundException('Asset is not available.');
    }
    return asset;
  }

  /** Read an already-authorized public document asset through the configured store. */
  async readPublicContent(assetId: string, organizationId: string) {
    const asset = await this.requireReadyAsset(assetId, organizationId);
    const buffer = await this.storage.readObject({ key: asset.storage_key });
    return { asset, buffer };
  }

  private async requireAsset(assetId: string, organizationId: string) {
    const asset = await this.assetModel
      .findOne(
        withOrganizationScope(organizationId, { _id: asObjectId(assetId) }),
      )
      .exec();
    if (!asset || asset.is_deleted) {
      throw new NotFoundException('Asset not found.');
    }
    return asset;
  }

  private async audit(
    asset: AssetDocument,
    actorUserId: string,
    action: string,
  ) {
    await this.auditLogModel.create({
      organization_id: asset.organization_id,
      actor_user_id: asObjectId(actorUserId, 'actor user id'),
      entity_type: 'asset',
      entity_id: String(asset._id),
      action,
      before_json: null,
      after_json: {
        owner_type: asset.owner_type,
        owner_id: String(asset.owner_id),
        kind: asset.kind,
        filename: asset.filename,
        size: asset.size,
        status: asset.status,
      },
    });
  }

  private serialize(asset: AssetDocument) {
    return {
      id: String(asset._id),
      organization_id: String(asset.organization_id),
      owner_type: asset.owner_type,
      owner_id: String(asset.owner_id),
      kind: asset.kind,
      filename: asset.filename,
      mime_type: asset.mime_type,
      size: asset.size,
      storage_provider: asset.storage_provider,
      checksum_sha256: asset.checksum_sha256 ?? null,
      width: asset.width ?? null,
      height: asset.height ?? null,
      status: asset.status,
      created_at: asset.created_at?.toISOString?.() ?? null,
      updated_at: asset.updated_at?.toISOString?.() ?? null,
    };
  }
}
