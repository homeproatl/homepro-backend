type AppEnv = {
  APP_PORT: number;
  MONGO_URI: string;
  BUSINESS_TIMEZONE?: string;
  FRONTEND_ORIGIN?: string;
  INVOICE_EMAIL_TRANSPORT?: string;
  INVOICE_EMAIL_FROM?: string;
  INVOICE_EMAIL_RESEND_API_KEY?: string;
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  JWT_ACCESS_TTL: string;
  JWT_REFRESH_TTL: string;
  OWNER_ADMIN_NAME?: string;
  OWNER_ADMIN_EMAIL?: string;
  OWNER_ADMIN_PASSWORD?: string;
};

function requiredValue(
  key: keyof AppEnv,
  env: NodeJS.ProcessEnv,
  fallback?: string,
): string {
  const value = env[key] ?? fallback;

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

function requiredMongoUri(env: NodeJS.ProcessEnv, fallback?: string): string {
  const value = env.MONGO_URI ?? fallback;

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

function requiredPort(env: NodeJS.ProcessEnv, fallback?: string): number {
  const value = requiredValue('APP_PORT', env, fallback);
  const port = Number.parseInt(value, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('APP_PORT must be an integer between 1 and 65535');
  }

  return port;
}

function optionalTimeZone(
  env: NodeJS.ProcessEnv,
  fallback?: string,
): string | undefined {
  const value = env.BUSINESS_TIMEZONE ?? fallback;

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

function optionalOrigin(
  env: NodeJS.ProcessEnv,
  fallback?: string,
): string | undefined {
  const value = env.FRONTEND_ORIGIN ?? fallback;

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

function optionalInvoiceTransport(
  env: NodeJS.ProcessEnv,
  fallback?: string,
): string | undefined {
  const value = env.INVOICE_EMAIL_TRANSPORT ?? fallback;

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
  fallback?: string,
) {
  const value = env[key] ?? fallback;
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

function optionalEnvValue(
  env: NodeJS.ProcessEnv,
  key: keyof Pick<
    AppEnv,
    'OWNER_ADMIN_NAME' | 'OWNER_ADMIN_EMAIL' | 'OWNER_ADMIN_PASSWORD'
  >,
  fallback?: string,
) {
  const value = env[key] ?? fallback;
  return value || undefined;
}

export function validateEnv(env: NodeJS.ProcessEnv): AppEnv {
  const isProd = env.NODE_ENV === 'production';

  const defaults: Partial<Record<keyof AppEnv, string>> = isProd
    ? {}
    : {
        APP_PORT: '4000',
        MONGO_URI: 'mongodb://127.0.0.1:27017/rico?replicaSet=rs0',
        BUSINESS_TIMEZONE: 'America/New_York',
        FRONTEND_ORIGIN: 'http://127.0.0.1:3000',
        INVOICE_EMAIL_TRANSPORT: 'DISABLED',
        INVOICE_EMAIL_FROM: 'billing@rico.local',
        JWT_ACCESS_SECRET: 'dev-access-secret',
        JWT_REFRESH_SECRET: 'dev-refresh-secret',
        JWT_ACCESS_TTL: '15m',
        JWT_REFRESH_TTL: '7d',
      };

  const invoiceTransport = optionalInvoiceTransport(
    env,
    defaults.INVOICE_EMAIL_TRANSPORT,
  );
  const invoiceEmailFrom = optionalEmailAddress(
    env,
    'INVOICE_EMAIL_FROM',
    defaults.INVOICE_EMAIL_FROM,
  );
  const resendApiKey = optionalResendApiKey(env);

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
    APP_PORT: requiredPort(env, defaults.APP_PORT),
    MONGO_URI: requiredMongoUri(env, defaults.MONGO_URI),
    BUSINESS_TIMEZONE: optionalTimeZone(env, defaults.BUSINESS_TIMEZONE),
    FRONTEND_ORIGIN: optionalOrigin(env, defaults.FRONTEND_ORIGIN),
    INVOICE_EMAIL_TRANSPORT: invoiceTransport,
    INVOICE_EMAIL_FROM: invoiceEmailFrom,
    INVOICE_EMAIL_RESEND_API_KEY: resendApiKey,
    JWT_ACCESS_SECRET: requiredValue(
      'JWT_ACCESS_SECRET',
      env,
      defaults.JWT_ACCESS_SECRET,
    ),
    JWT_REFRESH_SECRET: requiredValue(
      'JWT_REFRESH_SECRET',
      env,
      defaults.JWT_REFRESH_SECRET,
    ),
    JWT_ACCESS_TTL: requiredValue(
      'JWT_ACCESS_TTL',
      env,
      defaults.JWT_ACCESS_TTL,
    ),
    JWT_REFRESH_TTL: requiredValue(
      'JWT_REFRESH_TTL',
      env,
      defaults.JWT_REFRESH_TTL,
    ),
    OWNER_ADMIN_NAME: optionalEnvValue(
      env,
      'OWNER_ADMIN_NAME',
      defaults.OWNER_ADMIN_NAME,
    ),
    OWNER_ADMIN_EMAIL: optionalEnvValue(
      env,
      'OWNER_ADMIN_EMAIL',
      defaults.OWNER_ADMIN_EMAIL,
    ),
    OWNER_ADMIN_PASSWORD: optionalEnvValue(
      env,
      'OWNER_ADMIN_PASSWORD',
      defaults.OWNER_ADMIN_PASSWORD,
    ),
  };
}
