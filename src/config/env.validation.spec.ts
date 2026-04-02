import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  it('validates APP_PORT as integer range', () => {
    const env = validateEnv({
      NODE_ENV: 'development',
      OWNER_ADMIN_PASSWORD: 'secret',
      APP_PORT: '4000',
    });

    expect(env.APP_PORT).toBe(4000);
  });

  it('rejects invalid APP_PORT values', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        OWNER_ADMIN_PASSWORD: 'secret',
        APP_PORT: 'abc',
      }),
    ).toThrow('APP_PORT must be an integer between 1 and 65535');

    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        OWNER_ADMIN_PASSWORD: 'secret',
        APP_PORT: '70000',
      }),
    ).toThrow('APP_PORT must be an integer between 1 and 65535');
  });

  it('supports MONGO_URI with mongodb protocol', () => {
    const env = validateEnv({
      NODE_ENV: 'development',
      OWNER_ADMIN_PASSWORD: 'secret',
      MONGO_URI: 'mongodb://127.0.0.1:27017/rico?replicaSet=rs0',
    });

    expect(env.MONGO_URI).toBe('mongodb://127.0.0.1:27017/rico?replicaSet=rs0');
  });

  it('supports mongodb+srv protocol', () => {
    const env = validateEnv({
      NODE_ENV: 'development',
      OWNER_ADMIN_PASSWORD: 'secret',
      MONGO_URI: 'mongodb+srv://user:pass@cluster0.mongodb.net/rico',
    });

    expect(env.MONGO_URI).toBe(
      'mongodb+srv://user:pass@cluster0.mongodb.net/rico',
    );
  });

  it('supports Atlas-style multi-host mongodb URIs', () => {
    const env = validateEnv({
      NODE_ENV: 'development',
      OWNER_ADMIN_PASSWORD: 'secret',
      MONGO_URI:
        'mongodb://tired:tired@ac-gc3q509-shard-00-00.jhsrzzq.mongodb.net:27017,ac-gc3q509-shard-00-01.jhsrzzq.mongodb.net:27017,ac-gc3q509-shard-00-02.jhsrzzq.mongodb.net:27017/rico?ssl=true&replicaSet=atlas-8hz1ij-shard-0&authSource=admin&retryWrites=true&w=majority&appName=Cluster0',
    });

    expect(env.MONGO_URI).toBe(
      'mongodb://tired:tired@ac-gc3q509-shard-00-00.jhsrzzq.mongodb.net:27017,ac-gc3q509-shard-00-01.jhsrzzq.mongodb.net:27017,ac-gc3q509-shard-00-02.jhsrzzq.mongodb.net:27017/rico?ssl=true&replicaSet=atlas-8hz1ij-shard-0&authSource=admin&retryWrites=true&w=majority&appName=Cluster0',
    );
  });

  it('rejects invalid BUSINESS_TIMEZONE values', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        OWNER_ADMIN_PASSWORD: 'secret',
        BUSINESS_TIMEZONE: 'Broken/Timezone',
      }),
    ).toThrow('BUSINESS_TIMEZONE must be a valid IANA timezone');
  });

  it('allows BUSINESS_TIMEZONE to be omitted in production', () => {
    const env = validateEnv({
      NODE_ENV: 'production',
      APP_PORT: '4000',
      MONGO_URI: 'mongodb://127.0.0.1:27017/rico?replicaSet=rs0',
      JWT_ACCESS_SECRET: 'access-secret',
      JWT_REFRESH_SECRET: 'refresh-secret',
      JWT_ACCESS_TTL: '15m',
      JWT_REFRESH_TTL: '7d',
    });

    expect(env.BUSINESS_TIMEZONE).toBeUndefined();
  });

  it('validates FRONTEND_ORIGIN when provided', () => {
    const env = validateEnv({
      NODE_ENV: 'development',
      OWNER_ADMIN_PASSWORD: 'secret',
      FRONTEND_ORIGIN: 'https://rico.example.com',
    });

    expect(env.FRONTEND_ORIGIN).toBe('https://rico.example.com');
  });

  it('rejects invalid FRONTEND_ORIGIN values', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        OWNER_ADMIN_PASSWORD: 'secret',
        FRONTEND_ORIGIN: 'ftp://rico.example.com',
      }),
    ).toThrow('FRONTEND_ORIGIN must be a valid http(s) origin');
  });

  it('rejects non-mongo protocols', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        OWNER_ADMIN_PASSWORD: 'secret',
        MONGO_URI: 'https://example.com/not-mongo',
      }),
    ).toThrow('MONGO_URI must use mongodb:// or mongodb+srv:// protocol');
  });

  it('allows owner admin envs to be omitted during normal API boot', () => {
    const env = validateEnv({
      NODE_ENV: 'production',
      APP_PORT: '4000',
      MONGO_URI: 'mongodb://127.0.0.1:27017/rico?replicaSet=rs0',
      JWT_ACCESS_SECRET: 'access-secret',
      JWT_REFRESH_SECRET: 'refresh-secret',
      JWT_ACCESS_TTL: '15m',
      JWT_REFRESH_TTL: '7d',
    });

    expect(env.OWNER_ADMIN_NAME).toBeUndefined();
    expect(env.OWNER_ADMIN_EMAIL).toBeUndefined();
    expect(env.OWNER_ADMIN_PASSWORD).toBeUndefined();
  });

  it('accepts RESEND transport configuration when fully provided', () => {
    const env = validateEnv({
      NODE_ENV: 'production',
      APP_PORT: '4000',
      MONGO_URI: 'mongodb://127.0.0.1:27017/rico?replicaSet=rs0',
      JWT_ACCESS_SECRET: 'access-secret',
      JWT_REFRESH_SECRET: 'refresh-secret',
      JWT_ACCESS_TTL: '15m',
      JWT_REFRESH_TTL: '7d',
      INVOICE_EMAIL_TRANSPORT: 'RESEND',
      INVOICE_EMAIL_FROM: 'Gmb Workshop <billing@updates.rico.example>',
      INVOICE_EMAIL_RESEND_API_KEY: 're_test_123',
    });

    expect(env.INVOICE_EMAIL_TRANSPORT).toBe('RESEND');
    expect(env.INVOICE_EMAIL_FROM).toBe(
      'Gmb Workshop <billing@updates.rico.example>',
    );
    expect(env.INVOICE_EMAIL_RESEND_API_KEY).toBe('re_test_123');
  });

  it('rejects removed SMTP transport configuration', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        APP_PORT: '4000',
        MONGO_URI: 'mongodb://127.0.0.1:27017/rico?replicaSet=rs0',
        JWT_ACCESS_SECRET: 'access-secret',
        JWT_REFRESH_SECRET: 'refresh-secret',
        JWT_ACCESS_TTL: '15m',
        JWT_REFRESH_TTL: '7d',
        INVOICE_EMAIL_TRANSPORT: 'SMTP',
      }),
    ).toThrow('INVOICE_EMAIL_TRANSPORT must be LOG, DISABLED, or RESEND');
  });

  it('rejects partial RESEND configuration', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        APP_PORT: '4000',
        MONGO_URI: 'mongodb://127.0.0.1:27017/rico?replicaSet=rs0',
        JWT_ACCESS_SECRET: 'access-secret',
        JWT_REFRESH_SECRET: 'refresh-secret',
        JWT_ACCESS_TTL: '15m',
        JWT_REFRESH_TTL: '7d',
        INVOICE_EMAIL_TRANSPORT: 'RESEND',
        INVOICE_EMAIL_FROM: 'billing@updates.rico.example',
      }),
    ).toThrow(
      'INVOICE_EMAIL_RESEND_API_KEY is required when INVOICE_EMAIL_TRANSPORT is RESEND',
    );
  });
});
