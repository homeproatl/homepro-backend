type AppEnv = {
  APP_PORT: number;
  MONGO_URI: string;
  BUSINESS_TIMEZONE?: string;
  FRONTEND_ORIGIN?: string;
  PUBLIC_APP_BASE_URL?: string;
  OUTBOX_ENCRYPTION_KEY: string;
  INVOICE_EMAIL_TRANSPORT?: string;
  INVOICE_EMAIL_FROM?: string;
  INVOICE_EMAIL_RESEND_API_KEY?: string;
  ONLINE_INVOICE_PAYMENTS_ENABLED?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_LIVEMODE_EXPECTED?: string;
  STORAGE_PROVIDER?: string;
  STORAGE_UPLOAD_PREFIX?: string;
  ASSET_LOCAL_STORAGE_DIR?: string;
  R2_ACCOUNT_ID?: string;
  R2_BUCKET_NAME?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_SIGNED_URL_TTL_SECONDS?: string;
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  JWT_ACCESS_TTL: string;
  JWT_REFRESH_TTL: string;
  OWNER_ADMIN_NAME?: string;
  OWNER_ADMIN_EMAIL?: string;
  OWNER_ADMIN_PASSWORD?: string;
  COMPANY_ORGANIZATION_NAME?: string;
};

function requiredValue(key: keyof AppEnv, env: NodeJS.ProcessEnv): string {
  const value = env[key];

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

function requiredMongoUri(env: NodeJS.ProcessEnv): string {
  const value = env.MONGO_URI;

  if (!value) {
    throw new Error('Missing required environment variable: MONGO_URI');
  }

  const normalized = value.trim();
  const isMongoProtocol =
    normalized.startsWith('mongodb://') ||
    normalized.startsWith('mongodb+srv://');

  if (!isMongoProtocol) {
    throw new Error('MONGO_URI must use mongodb:// or mongodb+srv:// protocol');
  }

  const mongoUriPattern =
    /^mongodb(\+srv)?:\/\/[^/\s]+(?:\/[^\s?]*)?(?:\?[^\s#]*)?$/;

  if (!mongoUriPattern.test(normalized)) {
    throw new Error('Invalid MONGO_URI format');
  }

  return normalized;
}

function requiredPort(env: NodeJS.ProcessEnv): number {
  const value = requiredValue('APP_PORT', env);
  const port = Number.parseInt(value, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('APP_PORT must be an integer between 1 and 65535');
  }

  return port;
}

function optionalTimeZone(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.BUSINESS_TIMEZONE;

  if (!value) {
    return undefined;
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
  } catch {
    throw new Error('BUSINESS_TIMEZONE must be a valid IANA timezone');
  }

  return value;
}

function optionalOrigin(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.FRONTEND_ORIGIN;

  if (!value) {
    return undefined;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error();
    }
    return parsed.origin;
  } catch {
    throw new Error('FRONTEND_ORIGIN must be a valid http(s) origin');
  }
}

function optionalInvoiceTransport(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.INVOICE_EMAIL_TRANSPORT;

  if (!value) {
    return undefined;
  }

  const normalized = value.toUpperCase();
  if (
    normalized !== 'LOG' &&
    normalized !== 'DISABLED' &&
    normalized !== 'RESEND'
  ) {
    throw new Error('INVOICE_EMAIL_TRANSPORT must be LOG, DISABLED, or RESEND');
  }

  return normalized;
}

function optionalEmailAddress(
  env: NodeJS.ProcessEnv,
  key: keyof Pick<AppEnv, 'INVOICE_EMAIL_FROM'>,
) {
  const value = env[key];
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  const bareEmailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
  if (bareEmailPattern.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  const namedEmailMatch = trimmed.match(
    /^(.+?)\s*<\s*([^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)\s*>$/,
  );
  if (!namedEmailMatch) {
    throw new Error(`${key} must be a valid email address`);
  }

  const [, displayName, address] = namedEmailMatch;
  return `${displayName.trim()} <${address.toLowerCase()}>`;
}

function optionalResendApiKey(env: NodeJS.ProcessEnv) {
  const value = env.INVOICE_EMAIL_RESEND_API_KEY;
  if (!value) {
    return undefined;
  }

  return value.trim();
}

function optionalPublicAppBaseUrl(env: NodeJS.ProcessEnv): string | undefined {
  const value = env.PUBLIC_APP_BASE_URL;
  if (!value) {
    return undefined;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error();
    }
    return parsed.origin;
  } catch {
    throw new Error('PUBLIC_APP_BASE_URL must be a valid http(s) origin');
  }
}

function optionalBooleanString(env: NodeJS.ProcessEnv, key: keyof AppEnv) {
  const value = env[key];
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (
    !['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'].includes(normalized)
  ) {
    throw new Error(`${key} must be a boolean-like value`);
  }
  return value.trim();
}

function optionalStripeEnvValue(env: NodeJS.ProcessEnv, key: keyof AppEnv) {
  const value = env[key];
  return value?.trim() || undefined;
}

function validateStripeEnv(env: NodeJS.ProcessEnv) {
  const onlinePaymentsEnabled =
    optionalBooleanString(env, 'ONLINE_INVOICE_PAYMENTS_ENABLED') ?? 'false';
  const enabled = ['true', '1', 'yes', 'on'].includes(
    onlinePaymentsEnabled.toLowerCase(),
  );

  if (env.STRIPE_LIVEMODE_EXPECTED) {
    optionalBooleanString(env, 'STRIPE_LIVEMODE_EXPECTED');
  }
  if (enabled) {
    if (!env.STRIPE_SECRET_KEY?.trim()) {
      throw new Error(
        'STRIPE_SECRET_KEY is required when ONLINE_INVOICE_PAYMENTS_ENABLED is true',
      );
    }
    if (!env.STRIPE_WEBHOOK_SECRET?.trim()) {
      throw new Error(
        'STRIPE_WEBHOOK_SECRET is required when ONLINE_INVOICE_PAYMENTS_ENABLED is true',
      );
    }
    if (!env.PUBLIC_APP_BASE_URL?.trim() && !env.FRONTEND_ORIGIN?.trim()) {
      throw new Error(
        'PUBLIC_APP_BASE_URL or FRONTEND_ORIGIN is required when online payments are enabled',
      );
    }
    if (!env.STRIPE_LIVEMODE_EXPECTED?.trim()) {
      throw new Error(
        'STRIPE_LIVEMODE_EXPECTED is required when ONLINE_INVOICE_PAYMENTS_ENABLED is true',
      );
    }
  }

  return {
    ONLINE_INVOICE_PAYMENTS_ENABLED: onlinePaymentsEnabled,
    STRIPE_SECRET_KEY: optionalStripeEnvValue(env, 'STRIPE_SECRET_KEY'),
    STRIPE_WEBHOOK_SECRET: optionalStripeEnvValue(env, 'STRIPE_WEBHOOK_SECRET'),
    STRIPE_LIVEMODE_EXPECTED: optionalStripeEnvValue(
      env,
      'STRIPE_LIVEMODE_EXPECTED',
    ),
  };
}

function requiredOutboxEncryptionKey(env: NodeJS.ProcessEnv): string {
  const value = env.OUTBOX_ENCRYPTION_KEY;
  if (!value || value.trim().length < 16) {
    throw new Error(
      'OUTBOX_ENCRYPTION_KEY is required and must be at least 16 characters',
    );
  }
  return value.trim();
}

function optionalEnvValue(
  env: NodeJS.ProcessEnv,
  key: keyof Pick<
    AppEnv,
    | 'OWNER_ADMIN_NAME'
    | 'OWNER_ADMIN_EMAIL'
    | 'OWNER_ADMIN_PASSWORD'
    | 'COMPANY_ORGANIZATION_NAME'
  >,
) {
  const value = env[key];
  return value || undefined;
}

function optionalPositiveIntegerString(
  env: NodeJS.ProcessEnv,
  key: keyof AppEnv,
  fallback: string,
) {
  const value = env[key]?.trim() || fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${key} must be a positive integer`);
  }
  return String(parsed);
}

function optionalStorageProvider(env: NodeJS.ProcessEnv) {
  const provider = env.STORAGE_PROVIDER?.trim().toLowerCase() || 'local';
  if (provider !== 'local' && provider !== 'r2') {
    throw new Error('STORAGE_PROVIDER must be local or r2');
  }
  return provider;
}

function validateAssetStorageEnv(env: NodeJS.ProcessEnv) {
  const provider = optionalStorageProvider(env);
  const isProduction = env.NODE_ENV === 'production';

  if (isProduction && provider !== 'r2') {
    throw new Error('STORAGE_PROVIDER must be r2 in production');
  }
  if (provider === 'r2') {
    for (const key of [
      'R2_ACCOUNT_ID',
      'R2_BUCKET_NAME',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
    ] as const) {
      if (!env[key]?.trim()) {
        throw new Error(`${key} is required when STORAGE_PROVIDER is r2`);
      }
    }
  }

  return {
    STORAGE_PROVIDER: provider,
    STORAGE_UPLOAD_PREFIX: env.STORAGE_UPLOAD_PREFIX?.trim() || 'home-pro',
    ASSET_LOCAL_STORAGE_DIR:
      env.ASSET_LOCAL_STORAGE_DIR?.trim() || '.local-assets',
    R2_ACCOUNT_ID: env.R2_ACCOUNT_ID?.trim() || undefined,
    R2_BUCKET_NAME: env.R2_BUCKET_NAME?.trim() || undefined,
    R2_ACCESS_KEY_ID: env.R2_ACCESS_KEY_ID?.trim() || undefined,
    R2_SECRET_ACCESS_KEY: env.R2_SECRET_ACCESS_KEY?.trim() || undefined,
    R2_SIGNED_URL_TTL_SECONDS: optionalPositiveIntegerString(
      env,
      'R2_SIGNED_URL_TTL_SECONDS',
      '300',
    ),
  };
}

export function validateEnv(env: NodeJS.ProcessEnv): AppEnv {
  const invoiceTransport = optionalInvoiceTransport(env);
  const invoiceEmailFrom = optionalEmailAddress(env, 'INVOICE_EMAIL_FROM');
  const resendApiKey = optionalResendApiKey(env);
  const stripeEnv = validateStripeEnv(env);
  const assetStorageEnv = validateAssetStorageEnv(env);

  if (invoiceTransport === 'RESEND') {
    if (!invoiceEmailFrom) {
      throw new Error(
        'INVOICE_EMAIL_FROM is required when INVOICE_EMAIL_TRANSPORT is RESEND',
      );
    }

    if (!resendApiKey) {
      throw new Error(
        'INVOICE_EMAIL_RESEND_API_KEY is required when INVOICE_EMAIL_TRANSPORT is RESEND',
      );
    }
  }

  return {
    APP_PORT: requiredPort(env),
    MONGO_URI: requiredMongoUri(env),
    BUSINESS_TIMEZONE: optionalTimeZone(env),
    FRONTEND_ORIGIN: optionalOrigin(env),
    PUBLIC_APP_BASE_URL: optionalPublicAppBaseUrl(env),
    OUTBOX_ENCRYPTION_KEY: requiredOutboxEncryptionKey(env),
    INVOICE_EMAIL_TRANSPORT: invoiceTransport,
    INVOICE_EMAIL_FROM: invoiceEmailFrom,
    INVOICE_EMAIL_RESEND_API_KEY: resendApiKey,
    ...stripeEnv,
    ...assetStorageEnv,
    JWT_ACCESS_SECRET: requiredValue('JWT_ACCESS_SECRET', env),
    JWT_REFRESH_SECRET: requiredValue('JWT_REFRESH_SECRET', env),
    JWT_ACCESS_TTL: requiredValue('JWT_ACCESS_TTL', env),
    JWT_REFRESH_TTL: requiredValue('JWT_REFRESH_TTL', env),
    OWNER_ADMIN_NAME: optionalEnvValue(env, 'OWNER_ADMIN_NAME'),
    OWNER_ADMIN_EMAIL: optionalEnvValue(env, 'OWNER_ADMIN_EMAIL'),
    OWNER_ADMIN_PASSWORD: optionalEnvValue(env, 'OWNER_ADMIN_PASSWORD'),
    COMPANY_ORGANIZATION_NAME: optionalEnvValue(
      env,
      'COMPANY_ORGANIZATION_NAME',
    ),
  };
}
