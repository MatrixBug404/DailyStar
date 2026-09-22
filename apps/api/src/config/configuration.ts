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
export default () => ({
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

  /** MinIO / S3-compatible object storage */
  storage: {
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
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

  /** Logging */
  logLevel: process.env.LOG_LEVEL ?? 'log',
});
