import { ConfigService } from '@nestjs/config';
import { UserRole } from '../common/enums/user-role.enum';
import { SettingsService } from './settings.service';

const ORG_ID = '507f1f77bcf86cd7994390aa';

function baseSettingsDoc(overrides: Record<string, unknown> = {}) {
  const createdAt = new Date('2026-04-03T08:00:00.000Z');
  const updatedAt = new Date('2026-04-03T09:00:00.000Z');
  return {
    singleton_key: 'app',
    business_timezone: 'America/Chicago',
    account: {},
    company: {},
    documents: {},
    preferences: {},
    created_at: createdAt,
    updated_at: updatedAt,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createService(opts?: {
  findOneAndUpdateResult?: Record<string, unknown>;
  numbering?: {
    getNumberingConfig: jest.Mock;
    setPrefix: jest.Mock;
    setNextNumber: jest.Mock;
  };
  timezone?: string;
}) {
  const doc = baseSettingsDoc(opts?.findOneAndUpdateResult);
  const findOneAndUpdate = jest.fn().mockReturnValue({
    exec: jest.fn().mockResolvedValue(doc),
  });
  const numbering = opts?.numbering ?? {
    getNumberingConfig: jest
      .fn()
      .mockImplementation((_org: string, type: string) =>
        Promise.resolve({
          prefix: type === 'estimate' ? 'EST' : 'INV',
          next_number: 1,
          highest_allocated: 0,
        }),
      ),
    setPrefix: jest.fn().mockImplementation((_org, type, prefix) =>
      Promise.resolve({
        prefix,
        next_number: 1,
        highest_allocated: 0,
      }),
    ),
    setNextNumber: jest.fn().mockImplementation((_org, _type, next) =>
      Promise.resolve({
        prefix: 'EST',
        next_number: next,
        highest_allocated: next - 1,
      }),
    ),
  };

  const service = new SettingsService(
    { findOneAndUpdate } as never,
    {
      get: jest.fn().mockReturnValue(opts?.timezone ?? 'America/Chicago'),
    } as unknown as ConfigService,
    numbering as never,
  );

  return { service, findOneAndUpdate, numbering, doc };
}

describe('SettingsService', () => {
  it('creates app settings with defaults using an atomic upsert', async () => {
    const { service, findOneAndUpdate } = createService();

    const settings = (await service.getAppSettings(ORG_ID)) as Awaited<
      ReturnType<SettingsService['updateAppSettings']>
    >;

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: expect.anything(),
      }),
      {
        $setOnInsert: expect.objectContaining({
          singleton_key: 'app',
          business_timezone: 'America/Chicago',
        }),
      },
      expect.objectContaining({
        upsert: true,
        returnDocument: 'after',
      }),
    );
    expect(settings.business_timezone).toBe('America/Chicago');
    expect(settings.preferences.currency).toBe('usd');
    expect(settings.preferences.locale).toBe('en-US');
    expect(settings.documents.estimate_number_prefix).toBe('EST');
    expect(settings.documents.invoice_next_number).toBe(1);
    expect(settings.documents.default_payment_terms).toBe(
      'Payment is due within 30 days.',
    );
    expect(settings.documents.default_sales_tax_basis_points).toBe(0);
    expect(settings.documents.default_estimate_email_message).toContain(
      'attached estimate',
    );
    expect(settings.documents.default_invoice_email_message).toContain(
      'secure payment link',
    );
    expect(settings).not.toHaveProperty('stripe_secret_key');
    expect(settings).not.toHaveProperty('webhook_secret');
    expect(JSON.stringify(settings)).not.toMatch(/stripe/i);
  });

  it('rejects invalid timezones during update', async () => {
    const { service, doc } = createService();

    await expect(
      service.updateAppSettings(
        { business_timezone: 'Broken/Timezone' },
        ORG_ID,
      ),
    ).rejects.toThrow('Invalid business timezone');
    expect(doc.save).not.toHaveBeenCalled();
  });

  it('self-heals an invalid stored timezone by falling back to the configured default', async () => {
    const { service, doc } = createService({
      findOneAndUpdateResult: {
        business_timezone: 'Broken/Timezone',
      },
      timezone: 'America/New_York',
    });

    const settings = await service.getAppSettings(ORG_ID);

    expect(doc.save).toHaveBeenCalled();
    expect(doc.business_timezone).toBe('America/New_York');
    expect(settings.business_timezone).toBe('America/New_York');
  });

  it('preserves timezone when updating unrelated company fields', async () => {
    const { service, doc } = createService();

    const settings = await service.updateAppSettings(
      {
        company: {
          display_name: 'Acme Builders',
          phone: '555-0100',
        },
      },
      ORG_ID,
    );

    expect(doc.business_timezone).toBe('America/Chicago');
    expect(settings.business_timezone).toBe('America/Chicago');
    expect(settings.company.display_name).toBe('Acme Builders');
    expect(doc.save).toHaveBeenCalled();
  });

  it('ADMIN update applies account/company/document/preference fields', async () => {
    const { service, numbering } = createService();

    const settings = await service.updateAppSettings(
      {
        account: { first_name: 'Joseph', last_name: 'Owner' },
        company: {
          legal_name: 'Acme LLC',
          tax_id: '12-3456789',
          display_name: 'Acme',
        },
        documents: {
          estimate_number_prefix: 'QUOTE',
          default_invoice_due_days: 14,
          default_footer: 'Thanks',
        },
        preferences: {
          currency: 'USD',
          email_on_invoice_paid: false,
        },
      },
      ORG_ID,
    );

    expect(numbering.setPrefix).toHaveBeenCalledWith(
      ORG_ID,
      'estimate',
      'QUOTE',
    );
    expect(settings.account.first_name).toBe('Joseph');
    expect(settings.company.legal_name).toBe('Acme LLC');
    expect(settings.company.tax_id).toBe('12-3456789');
    expect(settings.documents.default_payment_terms).toBe(
      'Payment is due within 14 days.',
    );
    expect(settings.preferences.currency).toBe('usd');
    expect(settings.preferences.email_on_invoice_paid).toBe(false);
  });

  it('TECH projection omits legal identifiers and numbering controls', async () => {
    const { service } = createService({
      findOneAndUpdateResult: {
        company: {
          legal_name: 'Secret LLC',
          tax_id: '99-999',
          license_number: 'LIC-1',
          insurance_number: 'INS-1',
          display_name: 'Visible Co',
          phone: '555',
          email: null,
          website: null,
          industry: null,
          address: null,
          logo_asset_id: null,
        },
      },
    });

    const settings = await service.getAppSettings(ORG_ID, UserRole.TECHNICIAN);

    expect(settings.company).toEqual(
      expect.objectContaining({
        display_name: 'Visible Co',
        phone: '555',
      }),
    );
    expect(settings.company).not.toHaveProperty('legal_name');
    expect(settings.company).not.toHaveProperty('tax_id');
    expect(settings.company).not.toHaveProperty('license_number');
    expect(settings.company).not.toHaveProperty('insurance_number');
    expect(settings.documents).not.toHaveProperty('estimate_number_prefix');
    expect(settings.documents).not.toHaveProperty('invoice_number_prefix');
    expect(settings.documents).not.toHaveProperty('estimate_next_number');
    expect(settings.documents).not.toHaveProperty('invoice_next_number');
    expect(JSON.stringify(settings)).not.toMatch(/stripe/i);
  });

  it('serializers never include stripe or provider credential fields', async () => {
    const { service, doc } = createService({
      findOneAndUpdateResult: {
        stripe_secret_key: 'sk_test_should_never_leak',
        webhook_secret: 'whsec_should_never_leak',
        provider_readiness: { stripe: true },
      },
    });

    const settings = await service.getAppSettings(ORG_ID);
    const serialized = JSON.stringify(settings);

    expect(serialized).not.toContain('sk_test');
    expect(serialized).not.toContain('whsec');
    expect(serialized).not.toContain('provider_readiness');
    expect(serialized).not.toContain('stripe_secret_key');
    // Ensure raw doc extras are not copied through
    expect(doc).toHaveProperty('stripe_secret_key');
    expect(settings).not.toHaveProperty('stripe_secret_key');
  });
});
