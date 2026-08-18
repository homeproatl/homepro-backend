import { ValidationPipe } from '@nestjs/common';
import { CreateEstimateDocumentDto } from './create-estimate-document.dto';
import { UpdateEstimateDocumentDto } from './update-estimate-document.dto';

describe('estimate document write DTOs', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  const basePayload = {
    client_id: '507f1f77bcf86cd7994390ab',
    line_items: [
      {
        sort_order: 0,
        line_type: 'material',
        description: 'Paint',
        rate_minor: 10_000,
        quantity_milli: 1000,
        purchase_status: 'needed',
        internal_unit_cost_minor: 4000,
        waste_basis_points: 1000,
      },
    ],
  };

  it('accepts contractor estimate drafts without vehicle data', async () => {
    await expect(
      pipe.transform(
        {
          ...basePayload,
          job_name: 'Kitchen remodel',
          po_number: 'PO-100',
          customer_notes: 'Thank you.',
          private_notes: 'Call supplier before ordering.',
          deposit_requested_minor: 2500,
          document_photo_asset_ids: ['507f1f77bcf86cd7994390ac'],
          attachment_asset_ids: ['507f1f77bcf86cd7994390ad'],
        },
        { type: 'body', metatype: CreateEstimateDocumentDto },
      ),
    ).resolves.toMatchObject({
      client_id: '507f1f77bcf86cd7994390ab',
      job_name: 'Kitchen remodel',
      document_photo_asset_ids: ['507f1f77bcf86cd7994390ac'],
      attachment_asset_ids: ['507f1f77bcf86cd7994390ad'],
      line_items: [
        expect.objectContaining({
          description: 'Paint',
          line_type: 'material',
          purchase_status: 'needed',
        }),
      ],
    });
  });

  it('rejects vehicle, forged totals, and future invoice automation fields', async () => {
    await expect(
      pipe.transform(
        {
          ...basePayload,
          vehicle_id: '507f1f77bcf86cd7994390bb',
          total_minor: 1,
          subtotal_minor: 1,
          auto_generate_invoice_enabled: true,
          line_items: [
            {
              ...basePayload.line_items[0],
              total_minor: 1,
              internal_cost_total_minor: 1,
            },
          ],
        },
        { type: 'body', metatype: CreateEstimateDocumentDto },
      ),
    ).rejects.toBeDefined();
  });

  it('requires current version on updates and rejects future invoice automation fields', async () => {
    await expect(
      pipe.transform(
        {
          version: 3,
          job_name: 'Updated kitchen remodel',
          auto_generate_invoice_enabled: true,
        },
        { type: 'body', metatype: UpdateEstimateDocumentDto },
      ),
    ).rejects.toBeDefined();

    await expect(
      pipe.transform(
        {
          version: 3,
          job_name: 'Updated kitchen remodel',
        },
        { type: 'body', metatype: UpdateEstimateDocumentDto },
      ),
    ).resolves.toMatchObject({
      version: 3,
      job_name: 'Updated kitchen remodel',
    });
  });
});
