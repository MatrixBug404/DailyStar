process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://dailystar:changeme_local@localhost:5432/dailystar_dev?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.S3_PUBLIC_ENDPOINT = 'http://localhost:9000';
process.env.PUBLIC_COVER_PROXY_TRUST_SECRET = 'a'.repeat(32);
