import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AssetsService } from './assets.service';

function queryResult<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

function selectLeanResult<T>(value: T) {
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

describe('AssetsService', () => {
  const organizationId = new Types.ObjectId().toString();
  const documentId = new Types.ObjectId().toString();
  const actorUserId = new Types.ObjectId().toString();

  function createService() {
    const assetId = new Types.ObjectId();
    const assetModel = {
      create: jest.fn(async (payload) => ({
        _id: assetId,
        ...payload,
        created_at: new Date('2026-08-11T00:00:00.000Z'),
        updated_at: new Date('2026-08-11T00:00:00.000Z'),
      })),
      findOne: jest.fn(),
      updateOne: jest.fn(),
    };
    const clientModel = { countDocuments: jest.fn(() => queryResult(0)) };
    const documentModel = {
      countDocuments: jest.fn(() => queryResult(1)),
      findOne: jest.fn(() =>
        selectLeanResult({
          _id: documentId,
          document_photo_asset_ids: [],
          attachment_asset_ids: [],
          line_items: [],
        }),
      ),
      updateOne: jest.fn(),
      updateMany: jest.fn(),
    };
    const appSettingsModel = { updateOne: jest.fn() };
    const auditLogModel = { create: jest.fn() };
    const storage = {
      provider: 'local' as const,
      createObjectKey: jest.fn(() => 'assets/org/photo/file.png'),
      putObject: jest.fn(),
      createPresignedPutUrl: jest.fn(),
      createSignedGetUrl: jest.fn(),
      readObject: jest.fn(),
      inspectObject: jest.fn(),
      deleteObject: jest.fn(),
    };
    return {
      service: new AssetsService(
        assetModel as never,
        clientModel as never,
        documentModel as never,
        appSettingsModel as never,
        auditLogModel as never,
        storage as never,
      ),
      assetModel,
      documentModel,
      storage,
    };
  }

  it('stores a validated document photo without exposing the storage key', async () => {
    const { service, assetModel, documentModel, storage } = createService();

    const result = await service.createFromMultipart(
      {
        owner_type: 'document',
        owner_id: documentId,
        kind: 'photo',
        filename: 'job.png',
        mime_type: 'image/png',
        size: 1,
      },
      {
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        size: 8,
      } as Express.Multer.File,
      organizationId,
      actorUserId,
    );

    expect(storage.putObject).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'assets/org/photo/file.png' }),
    );
    expect(documentModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: expect.any(Types.ObjectId) }),
      { $addToSet: { document_photo_asset_ids: expect.any(Types.ObjectId) } },
    );
    expect(result).toMatchObject({
      id: expect.any(String),
      kind: 'photo',
      filename: 'job.png',
      status: 'ready',
    });
    expect(result).not.toHaveProperty('storage_key');
    expect(assetModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ checksum_sha256: expect.any(String) }),
    );
  });

  it('rejects files whose signature does not match the declared type', async () => {
    const { service } = createService();

    await expect(
      service.createFromMultipart(
        {
          owner_type: 'document',
          owner_id: documentId,
          kind: 'photo',
          filename: 'job.png',
          mime_type: 'image/png',
          size: 1,
        },
        { buffer: Buffer.from('not-a-png'), size: 9 } as Express.Multer.File,
        organizationId,
        actorUserId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('enforces the Joist-style document photo limit', async () => {
    const { service, documentModel } = createService();
    documentModel.findOne.mockReturnValueOnce(
      selectLeanResult({
        _id: documentId,
        document_photo_asset_ids: Array.from(
          { length: 20 },
          () => new Types.ObjectId(),
        ),
        attachment_asset_ids: [],
        line_items: [],
      }),
    );

    await expect(
      service.createFromMultipart(
        {
          owner_type: 'document',
          owner_id: documentId,
          kind: 'photo',
          filename: 'job.png',
          mime_type: 'image/png',
          size: 1,
        },
        {
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          size: 8,
        } as Express.Multer.File,
        organizationId,
        actorUserId,
      ),
    ).rejects.toThrow(/limited to 20/);
  });

  it('clones converted invoice media with an independent storage key', async () => {
    const { service, assetModel, documentModel, storage } = createService();
    const sourceAssetId = new Types.ObjectId();
    const sourceLineId = new Types.ObjectId();
    const targetLineId = new Types.ObjectId();
    const sourceAsset = {
      _id: sourceAssetId,
      organization_id: new Types.ObjectId(organizationId),
      owner_type: 'document',
      owner_id: new Types.ObjectId(documentId),
      kind: 'photo',
      filename: 'before.png',
      mime_type: 'image/png',
      size: 8,
      storage_provider: 'local',
      storage_key: 'assets/source.png',
      checksum_sha256: 'hash',
      caption: null,
      sort_order: 0,
      width: null,
      height: null,
      status: 'ready',
      is_deleted: false,
      created_at: new Date(),
      updated_at: new Date(),
    };
    assetModel.findOne
      .mockReturnValueOnce(queryResult(null))
      .mockReturnValueOnce(queryResult(sourceAsset));
    storage.readObject.mockResolvedValue(Buffer.from('image'));

    await service.cloneDocumentAssets(
      {
        organization_id: new Types.ObjectId(organizationId),
        document_photo_asset_ids: [sourceAssetId],
        attachment_asset_ids: [],
        line_items: [{ _id: sourceLineId, photo_asset_ids: [] }],
      } as never,
      {
        _id: new Types.ObjectId(documentId),
        line_items: [{ _id: targetLineId, photo_asset_ids: [] }],
      } as never,
      actorUserId,
    );

    expect(storage.readObject).toHaveBeenCalledWith({
      key: 'assets/source.png',
    });
    expect(storage.putObject).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'assets/org/photo/file.png' }),
    );
    expect(assetModel.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        owner_type: 'document',
        storage_key: 'assets/org/photo/file.png',
      }),
    );
    expect(documentModel.updateOne).toHaveBeenCalled();
  });
});
