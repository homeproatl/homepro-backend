import { validateEnv } from './env.validation';

function createEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'development',
    APP_PORT: '4000',
    MONGO_URI: 'mongodb://127.0.0.1:27017/contractor?replicaSet=rs0',
    JWT_ACCESS_SECRET: 'access-secret',
    JWT_REFRESH_SECRET: 'refresh-secret',
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '7d',
    OUTBOX_ENCRYPTION_KEY: 'test-outbox-encryption-key',
    ...overrides,
  };
}

function productionR2Env(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return createEnv({
    NODE_ENV: 'production',
    STORAGE_PROVIDER: 'r2',
    R2_ACCOUNT_ID: 'account-id',
    R2_BUCKET_NAME: 'contractor-assets',
    R2_ACCESS_KEY_ID: 'access-key',
    R2_SECRET_ACCESS_KEY: 'secret-key',
    ...overrides,
  });
}

describe('validateEnv', () => {
  it('validates APP_PORT as integer range', () => {
    const env = validateEnv(createEnv({ OWNER_ADMIN_PASSWORD: 'secret' }));

    expect(env.APP_PORT).toBe(4000);
  });

  it('rejects invalid APP_PORT values', () => {
    expect(() =>
      validateEnv(
        createEnv({
          APP_PORT: 'abc',
          OWNER_ADMIN_PASSWORD: 'secret',
        }),
      ),
    ).toThrow('APP_PORT must be an integer between 1 and 65535');

    expect(() =>
      validateEnv(
        createEnv({
          APP_PORT: '70000',
          OWNER_ADMIN_PASSWORD: 'secret',
        }),
      ),
    ).toThrow('APP_PORT must be an integer between 1 and 65535');
  });

  it('supports MONGO_URI with mongodb protocol', () => {
    const env = validateEnv(
      createEnv({
        MONGO_URI: 'mongodb://127.0.0.1:27017/contractor?replicaSet=rs0',
        OWNER_ADMIN_PASSWORD: 'secret',
      }),
    );

    expect(env.MONGO_URI).toBe(
      'mongodb://127.0.0.1:27017/contractor?replicaSet=rs0',
    );
  });

  it('supports mongodb+srv protocol', () => {
    const env = validateEnv(
      createEnv({
        MONGO_URI: 'mongodb+srv://user:pass@cluster0.mongodb.net/contractor',
        OWNER_ADMIN_PASSWORD: 'secret',
      }),
    );

    expect(env.MONGO_URI).toBe(
      'mongodb+srv://user:pass@cluster0.mongodb.net/contractor',
    );
  });

  it('supports Atlas-style multi-host mongodb URIs', () => {
    const env = validateEnv(
      createEnv({
        MONGO_URI:
          'mongodb://tired:tired@ac-gc3q509-shard-00-00.jhsrzzq.mongodb.net:27017,ac-gc3q509-shard-00-01.jhsrzzq.mongodb.net:27017,ac-gc3q509-shard-00-02.jhsrzzq.mongodb.net:27017/contractor?ssl=true&replicaSet=atlas-8hz1ij-shard-0&authSource=admin&retryWrites=true&w=majority&appName=Cluster0',
        OWNER_ADMIN_PASSWORD: 'secret',
      }),
    );

    expect(env.MONGO_URI).toBe(
      'mongodb://tired:tired@ac-gc3q509-shard-00-00.jhsrzzq.mongodb.net:27017,ac-gc3q509-shard-00-01.jhsrzzq.mongodb.net:27017,ac-gc3q509-shard-00-02.jhsrzzq.mongodb.net:27017/contractor?ssl=true&replicaSet=atlas-8hz1ij-shard-0&authSource=admin&retryWrites=true&w=majority&appName=Cluster0',
    );
  });

  it('rejects invalid BUSINESS_TIMEZONE values', () => {
    expect(() =>
      validateEnv(
        createEnv({
          BUSINESS_TIMEZONE: 'Broken/Timezone',
          OWNER_ADMIN_PASSWORD: 'secret',
        }),
      ),
    ).toThrow('BUSINESS_TIMEZONE must be a valid IANA timezone');
  });

  it('allows BUSINESS_TIMEZONE to be omitted in production', () => {
    const env = validateEnv(
      productionR2Env({
        APP_PORT: '4000',
        MONGO_URI: 'mongodb://127.0.0.1:27017/contractor?replicaSet=rs0',
        JWT_ACCESS_SECRET: 'access-secret',
        JWT_REFRESH_SECRET: 'refresh-secret',
        JWT_ACCESS_TTL: '15m',
        JWT_REFRESH_TTL: '7d',
        OUTBOX_ENCRYPTION_KEY: 'test-outbox-encryption-key',
      }),
    );

    expect(env.BUSINESS_TIMEZONE).toBeUndefined();
  });

  it('validates FRONTEND_ORIGIN when provided', () => {
    const env = validateEnv(
      createEnv({
        FRONTEND_ORIGIN: 'https://contractor.example.com',
        OWNER_ADMIN_PASSWORD: 'secret',
      }),
    );

    expect(env.FRONTEND_ORIGIN).toBe('https://contractor.example.com');
  });

  it('rejects invalid FRONTEND_ORIGIN values', () => {
    expect(() =>
      validateEnv(
        createEnv({
          FRONTEND_ORIGIN: 'ftp://contractor.example.com',
          OWNER_ADMIN_PASSWORD: 'secret',
        }),
      ),
    ).toThrow('FRONTEND_ORIGIN must be a valid http(s) origin');
  });

  it('rejects non-mongo protocols', () => {
    expect(() =>
      validateEnv(
        createEnv({
          MONGO_URI: 'https://example.com/not-mongo',
          OWNER_ADMIN_PASSWORD: 'secret',
        }),
      ),
    ).toThrow('MONGO_URI must use mongodb:// or mongodb+srv:// protocol');
  });

  it('requires explicit development env values without fallback defaults', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
      }),
    ).toThrow('Missing required environment variable: APP_PORT');
  });

  it('allows owner admin envs to be omitted during normal API boot', () => {
    const env = validateEnv(
      productionR2Env({
        APP_PORT: '4000',
        MONGO_URI: 'mongodb://127.0.0.1:27017/contractor?replicaSet=rs0',
        JWT_ACCESS_SECRET: 'access-secret',
        JWT_REFRESH_SECRET: 'refresh-secret',
        JWT_ACCESS_TTL: '15m',
        JWT_REFRESH_TTL: '7d',
        OUTBOX_ENCRYPTION_KEY: 'test-outbox-encryption-key',
      }),
    );

    expect(env.OWNER_ADMIN_NAME).toBeUndefined();
    expect(env.OWNER_ADMIN_EMAIL).toBeUndefined();
    expect(env.OWNER_ADMIN_PASSWORD).toBeUndefined();
  });

  it('accepts RESEND transport configuration when fully provided', () => {
    const env = validateEnv(
      productionR2Env({
        APP_PORT: '4000',
        MONGO_URI: 'mongodb://127.0.0.1:27017/contractor?replicaSet=rs0',
        JWT_ACCESS_SECRET: 'access-secret',
        JWT_REFRESH_SECRET: 'refresh-secret',
        JWT_ACCESS_TTL: '15m',
        JWT_REFRESH_TTL: '7d',
        OUTBOX_ENCRYPTION_KEY: 'test-outbox-encryption-key',
        INVOICE_EMAIL_TRANSPORT: 'RESEND',
        INVOICE_EMAIL_FROM: 'Home Pro <billing@updates.homepro.example>',
        INVOICE_EMAIL_RESEND_API_KEY: 're_test_123',
      }),
    );

    expect(env.INVOICE_EMAIL_TRANSPORT).toBe('RESEND');
    expect(env.INVOICE_EMAIL_FROM).toBe(
      'Home Pro <billing@updates.homepro.example>',
    );
    expect(env.INVOICE_EMAIL_RESEND_API_KEY).toBe('re_test_123');
  });

  it('rejects removed SMTP transport configuration', () => {
    expect(() =>
      validateEnv(
        productionR2Env({
          APP_PORT: '4000',
          MONGO_URI: 'mongodb://127.0.0.1:27017/contractor?replicaSet=rs0',
          JWT_ACCESS_SECRET: 'access-secret',
          JWT_REFRESH_SECRET: 'refresh-secret',
          JWT_ACCESS_TTL: '15m',
          JWT_REFRESH_TTL: '7d',
          OUTBOX_ENCRYPTION_KEY: 'test-outbox-encryption-key',
          INVOICE_EMAIL_TRANSPORT: 'SMTP',
        }),
      ),
    ).toThrow('INVOICE_EMAIL_TRANSPORT must be LOG, DISABLED, or RESEND');
  });

  it('rejects partial RESEND configuration', () => {
    expect(() =>
      validateEnv(
        productionR2Env({
          APP_PORT: '4000',
          MONGO_URI: 'mongodb://127.0.0.1:27017/contractor?replicaSet=rs0',
          JWT_ACCESS_SECRET: 'access-secret',
          JWT_REFRESH_SECRET: 'refresh-secret',
          JWT_ACCESS_TTL: '15m',
          JWT_REFRESH_TTL: '7d',
          OUTBOX_ENCRYPTION_KEY: 'test-outbox-encryption-key',
          INVOICE_EMAIL_TRANSPORT: 'RESEND',
          INVOICE_EMAIL_FROM: 'billing@updates.homepro.example',
        }),
      ),
    ).toThrow(
      'INVOICE_EMAIL_RESEND_API_KEY is required when INVOICE_EMAIL_TRANSPORT is RESEND',
    );
  });

  it('accepts online Stripe payments when Stripe and livemode are configured', () => {
    const env = validateEnv(
      productionR2Env({
        ONLINE_INVOICE_PAYMENTS_ENABLED: 'true',
        STRIPE_SECRET_KEY: 'sk_test_123',
        STRIPE_WEBHOOK_SECRET: 'whsec_123',
        STRIPE_LIVEMODE_EXPECTED: 'false',
        PUBLIC_APP_BASE_URL: 'https://app.homepro.example',
      }),
    );

    expect(env.ONLINE_INVOICE_PAYMENTS_ENABLED).toBe('true');
    expect(env.STRIPE_LIVEMODE_EXPECTED).toBe('false');
  });

  it('requires explicit Stripe livemode when online payments are enabled', () => {
    expect(() =>
      validateEnv(
        productionR2Env({
          ONLINE_INVOICE_PAYMENTS_ENABLED: 'true',
          STRIPE_SECRET_KEY: 'sk_test_123',
          STRIPE_WEBHOOK_SECRET: 'whsec_123',
          PUBLIC_APP_BASE_URL: 'https://app.homepro.example',
        }),
      ),
    ).toThrow(
      'STRIPE_LIVEMODE_EXPECTED is required when ONLINE_INVOICE_PAYMENTS_ENABLED is true',
    );
  });

  it('requires OUTBOX_ENCRYPTION_KEY', () => {
    expect(() =>
      validateEnv(
        createEnv({
          OUTBOX_ENCRYPTION_KEY: '',
        }),
      ),
    ).toThrow(
      'OUTBOX_ENCRYPTION_KEY is required and must be at least 16 characters',
    );
  });

  it('rejects local asset storage in production', () => {
    expect(() =>
      validateEnv(
        productionR2Env({
          STORAGE_PROVIDER: 'local',
        }),
      ),
    ).toThrow('STORAGE_PROVIDER must be r2 in production');
  });

  it('requires Cloudflare R2 credentials when R2 storage is selected', () => {
    expect(() =>
      validateEnv(
        createEnv({
          STORAGE_PROVIDER: 'r2',
          R2_BUCKET_NAME: 'contractor-assets',
          R2_ACCESS_KEY_ID: 'access-key',
          R2_SECRET_ACCESS_KEY: 'secret-key',
        }),
      ),
    ).toThrow('R2_ACCOUNT_ID is required when STORAGE_PROVIDER is r2');
  });
});
