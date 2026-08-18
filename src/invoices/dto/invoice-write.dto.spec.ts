import { ValidationPipe } from '@nestjs/common';
import { ConvertEstimateToInvoiceDto } from './convert-estimate-to-invoice.dto';
import { CreateInvoiceDto } from './create-invoice.dto';

describe('invoice write DTOs', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  it('accepts document photos and attachments on invoice creation', async () => {
    await expect(
      pipe.transform(
        {
          client_id: '507f1f77bcf86cd7994390ab',
          document_photo_asset_ids: ['507f1f77bcf86cd7994390ac'],
          attachment_asset_ids: ['507f1f77bcf86cd7994390ad'],
          online_payments_enabled: true,
          line_items: [
            {
              sort_order: 0,
              line_type: 'service',
              description: 'Roof repair',
              rate_minor: 10_000,
              quantity_milli: 1000,
            },
          ],
        },
        { type: 'body', metatype: CreateInvoiceDto },
      ),
    ).resolves.toMatchObject({
      document_photo_asset_ids: ['507f1f77bcf86cd7994390ac'],
      attachment_asset_ids: ['507f1f77bcf86cd7994390ad'],
      online_payments_enabled: true,
    });
  });

  it('validates estimate conversion overrides strictly', async () => {
    await expect(
      pipe.transform(
        { due_date: 'not-a-date' },
        { type: 'body', metatype: ConvertEstimateToInvoiceDto },
      ),
    ).rejects.toBeDefined();

    await expect(
      pipe.transform(
        { due_date: '2026-09-15', total_minor: 1 },
        { type: 'body', metatype: ConvertEstimateToInvoiceDto },
      ),
    ).rejects.toBeDefined();

    await expect(
      pipe.transform(
        { due_date: '2026-09-15' },
        { type: 'body', metatype: ConvertEstimateToInvoiceDto },
      ),
    ).resolves.toMatchObject({ due_date: '2026-09-15' });
  });
});
