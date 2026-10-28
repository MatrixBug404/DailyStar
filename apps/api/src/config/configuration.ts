/**
 * NestJS application configuration factory.
 *
 * Reads environment variables and exposes them as a typed config object
 * via NestJS ConfigModule. Add new config sections here as new modules
 * are introduced in later phases.
 *
 * Usage:
 *   constructor(@Inject(configuration.KEY) private config: ConfigType<typeof configuration>) {}
 */
/**
 * Parses a positive integer environment variable.
 * Invalid values fail startup rather than being silently clamped.
 */
function readPositiveInt(name: string, fallback: number, max?: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;

  const parsed = Number(raw);
  const constraint = max === undefined ? 'an integer >= 1' : `an integer between 1 and ${max}`;
  if (!Number.isInteger(parsed) || parsed < 1 || (max !== undefined && parsed > max)) {
    throw new Error(`${name} must be ${constraint}`);
  }
  return parsed;
}

/** Parses a strict boolean environment variable ("true" / "false"). */
function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;

  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error(`${name} must be "true" or "false"`);
}

export default () => {
  const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT;
  if (
    !publicEndpoint ||
    (!publicEndpoint.startsWith('http://') && !publicEndpoint.startsWith('https://'))
  ) {
    throw new Error(
      'S3_PUBLIC_ENDPOINT is mandatory and must be a valid URL starting with http:// or https://',
    );
  }

  const coverProxyTrustSecret = process.env.PUBLIC_COVER_PROXY_TRUST_SECRET;
  if (!coverProxyTrustSecret || coverProxyTrustSecret.length < 32) {
    throw new Error(
      'PUBLIC_COVER_PROXY_TRUST_SECRET is mandatory and must be at least 32 characters long',
    );
  }

  const emailProvider = (process.env.EMAIL_PROVIDER ?? 'log').trim().toLowerCase() || 'log';
  if (emailProvider !== 'log' && emailProvider !== 'postmark') {
    throw new Error(`EMAIL_PROVIDER must be one of: log, postmark (received "${emailProvider}")`);
  }

  const emailFrom = process.env.EMAIL_FROM?.trim() || 'DailyStar <notifications@dailystar.local>';
  const postmarkServerToken = process.env.POSTMARK_SERVER_TOKEN?.trim() ?? '';
  if (emailProvider === 'postmark' && !postmarkServerToken) {
    throw new Error('POSTMARK_SERVER_TOKEN is required when EMAIL_PROVIDER=postmark');
  }

  const configuredRecoveryMaxAttempts = parseInt(
    process.env.SCHEDULING_RECOVERY_MAX_ATTEMPTS ?? '3',
    10,
  );

  return {
    /** Application runtime environment */
    nodeEnv: process.env.NODE_ENV ?? 'local',

    /** HTTP server port */
    port: parseInt(process.env.PORT ?? '3001', 10),

    /** Allowed CORS origins (comma-separated in env) */
    corsOrigins: process.env.CORS_ORIGINS?.split(',') ?? ['http://localhost:3000'],

    /** PostgreSQL / Prisma connection URL */
    database: {
      url: process.env.DATABASE_URL ?? '',
    },

    /** Redis connection */
    redis: {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      password: process.env.REDIS_PASSWORD ?? undefined,
    },

    /** Scheduled publishing recovery policy */
    scheduling: {
      /**
       * Maximum number of overdue missing/completed-job repairs the safety
       * sweep will perform for one PublicationSchedule before invoking the
       * state-aware terminal-failure path.
       */
      recoveryMaxAttempts:
        Number.isFinite(configuredRecoveryMaxAttempts) && configuredRecoveryMaxAttempts > 0
          ? configuredRecoveryMaxAttempts
          : 3,
    },

    /** MinIO / S3-compatible object storage */
    storage: {
      endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
      publicEndpoint,
      region: process.env.S3_REGION ?? 'us-east-1',
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
      bucket: process.env.S3_BUCKET ?? 'dailystar-media',
    },

    /** Media handling */
    media: {
      maxFileSizeBytes: parseInt(process.env.MEDIA_MAX_FILE_SIZE_BYTES ?? '10485760', 10),
      signedUrlExpirySeconds: parseInt(process.env.MEDIA_SIGNED_URL_EXPIRY_SECONDS ?? '3600', 10),
    },

    /** JWT configuration — active from Phase 1 */
    jwt: {
      accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
      refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
      accessExpiry: process.env.JWT_ACCESS_EXPIRY ?? '15m',
      refreshExpiry: process.env.JWT_REFRESH_EXPIRY ?? '7d',
    },

    /** Security configuration */
    security: {
      coverProxyTrustSecret,
    },

    /** Phase 8 notification email delivery */
    notifications: {
      email: {
        provider: emailProvider,
        from: emailFrom,
        postmarkServerToken,
        maxAttempts: readPositiveInt('EMAIL_MAX_ATTEMPTS', 5),
        reconcileEnabled: readBoolean('EMAIL_RECONCILE_ENABLED', true),
        reconcileBatchSize: readPositiveInt('EMAIL_RECONCILE_BATCH_SIZE', 200, 1000),
        reconcileStaleMinutes: readPositiveInt('EMAIL_RECONCILE_STALE_MINUTES', 10),
      },
    },

    /** Logging */
    logLevel: process.env.LOG_LEVEL ?? 'log',
  };
};
