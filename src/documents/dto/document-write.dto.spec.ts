import { ValidationPipe } from '@nestjs/common';
import { CreateDocumentDto } from './create-document.dto';

describe('document write DTOs', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  const basePayload = {
    type: 'estimate',
    client_id: '507f1f77bcf86cd7994390ab',
    line_items: [
      {
        sort_order: 0,
        line_type: 'service',
        description: 'Roof repair',
        rate_minor: 10_000,
        quantity_milli: 1000,
      },
    ],
  };

  it('rejects client-supplied ownership, vehicle, and calculated fields', async () => {
    await expect(
      pipe.transform(
        {
          ...basePayload,
          organization_id: '507f1f77bcf86cd7994390aa',
          vehicle_id: '507f1f77bcf86cd7994390bb',
          subtotal_minor: 1,
          total_minor: 1,
          line_items: [
            {
              ...basePayload.line_items[0],
              subtotal_minor: 1,
              total_minor: 1,
              tax_amount_minor: 1,
            },
          ],
        },
        { type: 'body', metatype: CreateDocumentDto },
      ),
    ).rejects.toBeDefined();
  });

  it('accepts a minimal estimate without vehicle_id', async () => {
    await expect(
      pipe.transform(basePayload, {
        type: 'body',
        metatype: CreateDocumentDto,
      }),
    ).resolves.toMatchObject({
      type: 'estimate',
      client_id: '507f1f77bcf86cd7994390ab',
      line_items: [
        expect.objectContaining({
          description: 'Roof repair',
          rate_minor: 10_000,
          quantity_milli: 1000,
        }),
      ],
    });
  });

  it('accepts validated document photo and attachment ids', async () => {
    await expect(
      pipe.transform(
        {
          ...basePayload,
          document_photo_asset_ids: ['507f1f77bcf86cd7994390ac'],
          attachment_asset_ids: ['507f1f77bcf86cd7994390ad'],
        },
        { type: 'body', metatype: CreateDocumentDto },
      ),
    ).resolves.toMatchObject({
      document_photo_asset_ids: ['507f1f77bcf86cd7994390ac'],
      attachment_asset_ids: ['507f1f77bcf86cd7994390ad'],
    });
  });
});
