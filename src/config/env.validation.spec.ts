import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  it('validates APP_PORT as integer range', () => {
    const env = validateEnv({
      NODE_ENV: 'development',
      SUPER_ADMIN_PASSWORD: 'secret',
      APP_PORT: '4000',
    });

    expect(env.APP_PORT).toBe(4000);
  });

  it('rejects invalid APP_PORT values', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        SUPER_ADMIN_PASSWORD: 'secret',
        APP_PORT: 'abc',
      }),
    ).toThrow('APP_PORT must be an integer between 1 and 65535');

    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        SUPER_ADMIN_PASSWORD: 'secret',
        APP_PORT: '70000',
      }),
    ).toThrow('APP_PORT must be an integer between 1 and 65535');
  });

  it('supports MONGO_URI with mongodb protocol', () => {
    const env = validateEnv({
      NODE_ENV: 'development',
      SUPER_ADMIN_PASSWORD: 'secret',
      MONGO_URI: 'mongodb://127.0.0.1:27017/rico?replicaSet=rs0',
    });

    expect(env.MONGO_URI).toBe('mongodb://127.0.0.1:27017/rico?replicaSet=rs0');
  });

  it('supports mongodb+srv protocol', () => {
    const env = validateEnv({
      NODE_ENV: 'development',
      SUPER_ADMIN_PASSWORD: 'secret',
      MONGO_URI: 'mongodb+srv://user:pass@cluster0.mongodb.net/rico',
    });

    expect(env.MONGO_URI).toBe(
      'mongodb+srv://user:pass@cluster0.mongodb.net/rico',
    );
  });

  it('supports Atlas-style multi-host mongodb URIs', () => {
    const env = validateEnv({
      NODE_ENV: 'development',
      SUPER_ADMIN_PASSWORD: 'secret',
      MONGO_URI:
        'mongodb://tired:tired@ac-gc3q509-shard-00-00.jhsrzzq.mongodb.net:27017,ac-gc3q509-shard-00-01.jhsrzzq.mongodb.net:27017,ac-gc3q509-shard-00-02.jhsrzzq.mongodb.net:27017/rico?ssl=true&replicaSet=atlas-8hz1ij-shard-0&authSource=admin&retryWrites=true&w=majority&appName=Cluster0',
    });

    expect(env.MONGO_URI).toBe(
      'mongodb://tired:tired@ac-gc3q509-shard-00-00.jhsrzzq.mongodb.net:27017,ac-gc3q509-shard-00-01.jhsrzzq.mongodb.net:27017,ac-gc3q509-shard-00-02.jhsrzzq.mongodb.net:27017/rico?ssl=true&replicaSet=atlas-8hz1ij-shard-0&authSource=admin&retryWrites=true&w=majority&appName=Cluster0',
    );
  });

  it('supports legacy MONGODB_URI alias', () => {
    const env = validateEnv({
      NODE_ENV: 'development',
      SUPER_ADMIN_PASSWORD: 'secret',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/rico?replicaSet=rs0',
    });

    expect(env.MONGO_URI).toBe('mongodb://127.0.0.1:27017/rico?replicaSet=rs0');
  });

  it('rejects invalid BUSINESS_TIMEZONE values', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        SUPER_ADMIN_PASSWORD: 'secret',
        BUSINESS_TIMEZONE: 'Broken/Timezone',
      }),
    ).toThrow('BUSINESS_TIMEZONE must be a valid IANA timezone');
  });

  it('validates FRONTEND_ORIGIN when provided', () => {
    const env = validateEnv({
      NODE_ENV: 'development',
      SUPER_ADMIN_PASSWORD: 'secret',
      FRONTEND_ORIGIN: 'https://rico.example.com',
    });

    expect(env.FRONTEND_ORIGIN).toBe('https://rico.example.com');
  });

  it('rejects invalid FRONTEND_ORIGIN values', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        SUPER_ADMIN_PASSWORD: 'secret',
        FRONTEND_ORIGIN: 'ftp://rico.example.com',
      }),
    ).toThrow('FRONTEND_ORIGIN must be a valid http(s) origin');
  });

  it('rejects non-mongo protocols', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        SUPER_ADMIN_PASSWORD: 'secret',
        MONGO_URI: 'https://example.com/not-mongo',
      }),
    ).toThrow('MONGO_URI must use mongodb:// or mongodb+srv:// protocol');
  });

  it('requires SUPER_ADMIN_PASSWORD even outside production', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
      }),
    ).toThrow('Missing required environment variable: SUPER_ADMIN_PASSWORD');
  });

  it('accepts SMTP transport configuration when fully provided', () => {
    const env = validateEnv({
      NODE_ENV: 'production',
      APP_PORT: '4000',
      MONGO_URI: 'mongodb://127.0.0.1:27017/rico?replicaSet=rs0',
      BUSINESS_TIMEZONE: 'America/New_York',
      JWT_ACCESS_SECRET: 'access-secret',
      JWT_REFRESH_SECRET: 'refresh-secret',
      JWT_ACCESS_TTL: '15m',
      JWT_REFRESH_TTL: '7d',
      SUPER_ADMIN_NAME: 'Rico',
      SUPER_ADMIN_EMAIL: 'rico@admin.com',
      SUPER_ADMIN_PASSWORD: 'secret',
      INVOICE_EMAIL_TRANSPORT: 'SMTP',
      INVOICE_EMAIL_FROM: 'billing@rico.local',
      INVOICE_EMAIL_SMTP_HOST: 'smtp.example.com',
      INVOICE_EMAIL_SMTP_PORT: '587',
      INVOICE_EMAIL_SMTP_SECURE: 'false',
      INVOICE_EMAIL_SMTP_USER: 'smtp-user',
      INVOICE_EMAIL_SMTP_PASS: 'smtp-pass',
    });

    expect(env.INVOICE_EMAIL_TRANSPORT).toBe('SMTP');
    expect(env.INVOICE_EMAIL_SMTP_HOST).toBe('smtp.example.com');
    expect(env.INVOICE_EMAIL_SMTP_PORT).toBe(587);
    expect(env.INVOICE_EMAIL_SMTP_SECURE).toBe(false);
  });

  it('rejects partial SMTP configuration', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        APP_PORT: '4000',
        MONGO_URI: 'mongodb://127.0.0.1:27017/rico?replicaSet=rs0',
        BUSINESS_TIMEZONE: 'America/New_York',
        JWT_ACCESS_SECRET: 'access-secret',
        JWT_REFRESH_SECRET: 'refresh-secret',
        JWT_ACCESS_TTL: '15m',
        JWT_REFRESH_TTL: '7d',
        SUPER_ADMIN_NAME: 'Rico',
        SUPER_ADMIN_EMAIL: 'rico@admin.com',
        SUPER_ADMIN_PASSWORD: 'secret',
        INVOICE_EMAIL_TRANSPORT: 'SMTP',
        INVOICE_EMAIL_FROM: 'billing@rico.local',
        INVOICE_EMAIL_SMTP_HOST: 'smtp.example.com',
      }),
    ).toThrow(
      'INVOICE_EMAIL_SMTP_PORT is required when INVOICE_EMAIL_TRANSPORT is SMTP',
    );
  });
});
