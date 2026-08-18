import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { asObjectId } from '../common/utils/object-id';
import { withOrganizationScope } from '../common/utils/organization-scope';
import { generateAccessToken, hashAccessToken } from './document-token.crypto';
import {
  DocumentAccessGrant,
  DocumentAccessGrantDocument,
  DocumentGrantPermission,
} from './schemas/document-access-grant.schema';

const DEFAULT_ESTIMATE_PERMISSIONS: DocumentGrantPermission[] = [
  'view',
  'download',
  'approve',
  'decline',
  'sign',
];

@Injectable()
export class DocumentAccessGrantsService {
  constructor(
    @InjectModel(DocumentAccessGrant.name)
    private readonly grantModel: Model<DocumentAccessGrantDocument>,
  ) {}

  /**
   * Create a new grant and revoke prior active grants for the same document.
   * Returns plaintext token once — only the hash is persisted.
   */
  async rotateGrant(input: {
    organizationId: string;
    documentId: string;
    createdByUserId: string;
    permissions?: DocumentGrantPermission[];
    expiresAt?: Date | null;
  }): Promise<{ grant: DocumentAccessGrantDocument; token: string }> {
    const token = generateAccessToken();
    const grant = await this.installGrant({
      ...input,
      token,
    });
    return { grant, token };
  }

  /**
   * Install a grant for a pre-generated plaintext token, revoking prior active
   * grants. Used by send so the outbox payload and live grant stay aligned.
   */
  async installGrant(input: {
    organizationId: string;
    documentId: string;
    createdByUserId: string;
    token: string;
    permissions?: DocumentGrantPermission[];
    expiresAt?: Date | null;
  }): Promise<DocumentAccessGrantDocument> {
    const organizationId = asObjectId(input.organizationId, 'organization id');
    const documentId = asObjectId(input.documentId, 'document id');
    const tokenHash = hashAccessToken(input.token);

    // Revoke first so the partial unique active-grant index allows insert.
    await this.grantModel
      .updateMany(
        withOrganizationScope(input.organizationId, {
          document_id: documentId,
          revoked_at: null,
        }),
        { $set: { revoked_at: new Date() } },
      )
      .exec();

    try {
      const grant = await this.grantModel.create({
        organization_id: organizationId,
        document_id: documentId,
        token_hash: tokenHash,
        permissions: input.permissions ?? DEFAULT_ESTIMATE_PERMISSIONS,
        expires_at: input.expiresAt ?? null,
        revoked_at: null,
        last_accessed_at: null,
        created_by_user_id: asObjectId(input.createdByUserId, 'actor user id'),
      });

      // Belt-and-suspenders: revoke any other active grants that raced in.
      await this.grantModel
        .updateMany(
          withOrganizationScope(input.organizationId, {
            document_id: documentId,
            revoked_at: null,
            _id: { $ne: grant._id },
          }),
          { $set: { revoked_at: new Date() } },
        )
        .exec();

      return grant;
    } catch (error) {
      if (!this.isDuplicateKey(error)) {
        throw error;
      }
      // Active-grant unique conflict: revoke again and retry once.
      await this.grantModel
        .updateMany(
          withOrganizationScope(input.organizationId, {
            document_id: documentId,
            revoked_at: null,
          }),
          { $set: { revoked_at: new Date() } },
        )
        .exec();
      return this.grantModel.create({
        organization_id: organizationId,
        document_id: documentId,
        token_hash: tokenHash,
        permissions: input.permissions ?? DEFAULT_ESTIMATE_PERMISSIONS,
        expires_at: input.expiresAt ?? null,
        revoked_at: null,
        last_accessed_at: null,
        created_by_user_id: asObjectId(input.createdByUserId, 'actor user id'),
      });
    }
  }

  async findValidGrantByToken(token: string) {
    const tokenHash = hashAccessToken(token);
    const grant = await this.grantModel
      .findOne({ token_hash: tokenHash })
      .exec();
    if (!grant || !this.isGrantActive(grant)) {
      throw new UnauthorizedException('Invalid or expired link');
    }
    return grant;
  }

  /**
   * Returns the active grant for a token hash, if any. Used by send recovery
   * to avoid rotating an already-installed grant that matches the outbox token.
   */
  async findActiveByTokenHash(tokenHash: string) {
    const grant = await this.grantModel
      .findOne({ token_hash: tokenHash, revoked_at: null })
      .exec();
    if (!grant || !this.isGrantActive(grant)) {
      return null;
    }
    return grant;
  }

  async touchAccess(grantId: Types.ObjectId) {
    await this.grantModel
      .updateOne({ _id: grantId }, { $set: { last_accessed_at: new Date() } })
      .exec();
  }

  assertPermission(
    grant: DocumentAccessGrantDocument,
    permission: DocumentGrantPermission,
  ) {
    if (!grant.permissions.includes(permission)) {
      throw new UnauthorizedException('Invalid or expired link');
    }
  }

  async revokeGrant(input: {
    organizationId: string;
    documentId: string;
    grantId: string;
  }) {
    const updated = await this.grantModel
      .findOneAndUpdate(
        withOrganizationScope(input.organizationId, {
          _id: asObjectId(input.grantId, 'grant id'),
          document_id: asObjectId(input.documentId, 'document id'),
          revoked_at: null,
        }),
        { $set: { revoked_at: new Date() } },
        { returnDocument: 'after' },
      )
      .exec();
    if (!updated) {
      throw new NotFoundException('Access grant not found');
    }
    return updated;
  }

  async listActiveForDocument(organizationId: string, documentId: string) {
    return this.grantModel
      .find(
        withOrganizationScope(organizationId, {
          document_id: asObjectId(documentId, 'document id'),
          revoked_at: null,
        }),
      )
      .sort({ created_at: -1 })
      .exec();
  }

  private isGrantActive(grant: DocumentAccessGrantDocument) {
    if (grant.revoked_at != null) {
      return false;
    }
    if (grant.expires_at != null && grant.expires_at.getTime() <= Date.now()) {
      return false;
    }
    return true;
  }

  private isDuplicateKey(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: number }).code === 11000
    );
  }
}
