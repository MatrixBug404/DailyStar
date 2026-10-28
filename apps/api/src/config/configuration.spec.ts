import configuration from './configuration';

describe('configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    process.env.S3_PUBLIC_ENDPOINT = 'http://localhost:9000';
    process.env.PUBLIC_COVER_PROXY_TRUST_SECRET = 'a'.repeat(32);
    delete process.env.EMAIL_PROVIDER;
    delete process.env.EMAIL_FROM;
    delete process.env.POSTMARK_SERVER_TOKEN;
    delete process.env.EMAIL_MAX_ATTEMPTS;
    delete process.env.EMAIL_RECONCILE_ENABLED;
    delete process.env.EMAIL_RECONCILE_BATCH_SIZE;
    delete process.env.EMAIL_RECONCILE_STALE_MINUTES;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should throw if S3_PUBLIC_ENDPOINT is missing', () => {
    delete process.env.S3_PUBLIC_ENDPOINT;
    process.env.PUBLIC_COVER_PROXY_TRUST_SECRET = 'a'.repeat(32);
    expect(() => configuration()).toThrow('S3_PUBLIC_ENDPOINT is mandatory');
  });

  it('should throw if S3_PUBLIC_ENDPOINT is malformed', () => {
    process.env.S3_PUBLIC_ENDPOINT = 'ftp://localhost';
    process.env.PUBLIC_COVER_PROXY_TRUST_SECRET = 'a'.repeat(32);
    expect(() => configuration()).toThrow('S3_PUBLIC_ENDPOINT is mandatory');
  });

  it('should throw if PUBLIC_COVER_PROXY_TRUST_SECRET is missing', () => {
    process.env.S3_PUBLIC_ENDPOINT = 'http://localhost';
    delete process.env.PUBLIC_COVER_PROXY_TRUST_SECRET;
    expect(() => configuration()).toThrow('PUBLIC_COVER_PROXY_TRUST_SECRET is mandatory');
  });

  it('should throw if PUBLIC_COVER_PROXY_TRUST_SECRET is too short', () => {
    process.env.S3_PUBLIC_ENDPOINT = 'http://localhost';
    process.env.PUBLIC_COVER_PROXY_TRUST_SECRET = 'short';
    expect(() => configuration()).toThrow('PUBLIC_COVER_PROXY_TRUST_SECRET is mandatory');
  });

  it('should succeed with valid env vars', () => {
    process.env.S3_PUBLIC_ENDPOINT = 'http://localhost:9000';
    process.env.PUBLIC_COVER_PROXY_TRUST_SECRET = 'a'.repeat(32);
    const config = configuration();
    expect(config.storage.publicEndpoint).toBe('http://localhost:9000');
    expect(config.security.coverProxyTrustSecret).toBe('a'.repeat(32));
  });

  describe('notification email configuration', () => {
    it('defaults to the log provider with documented delivery policy values', () => {
      const config = configuration();

      expect(config.notifications.email).toEqual({
        provider: 'log',
        from: 'DailyStar <notifications@dailystar.local>',
        postmarkServerToken: '',
        maxAttempts: 5,
        reconcileEnabled: true,
        reconcileBatchSize: 200,
        reconcileStaleMinutes: 10,
      });
    });

    it('accepts the postmark provider when a token is configured', () => {
      process.env.EMAIL_PROVIDER = 'postmark';
      process.env.POSTMARK_SERVER_TOKEN = 'pm-token';
      process.env.EMAIL_FROM = 'Newsroom <news@dailystar.local>';

      const config = configuration();

      expect(config.notifications.email.provider).toBe('postmark');
      expect(config.notifications.email.postmarkServerToken).toBe('pm-token');
      expect(config.notifications.email.from).toBe('Newsroom <news@dailystar.local>');
    });

    it('rejects an unsupported provider at startup', () => {
      process.env.EMAIL_PROVIDER = 'sendgrid';

      expect(() => configuration()).toThrow(
        'EMAIL_PROVIDER must be one of: log, postmark (received "sendgrid")',
      );
    });

    it('requires a non-empty token when postmark is selected', () => {
      process.env.EMAIL_PROVIDER = 'postmark';

      expect(() => configuration()).toThrow(
        'POSTMARK_SERVER_TOKEN is required when EMAIL_PROVIDER=postmark',
      );
    });

    it('rejects a non-integer EMAIL_MAX_ATTEMPTS', () => {
      process.env.EMAIL_MAX_ATTEMPTS = '2.5';

      expect(() => configuration()).toThrow('EMAIL_MAX_ATTEMPTS must be an integer >= 1');
    });

    it('rejects EMAIL_MAX_ATTEMPTS below one', () => {
      process.env.EMAIL_MAX_ATTEMPTS = '0';

      expect(() => configuration()).toThrow('EMAIL_MAX_ATTEMPTS must be an integer >= 1');
    });

    it('rejects an oversized reconciliation batch', () => {
      process.env.EMAIL_RECONCILE_BATCH_SIZE = '1001';

      expect(() => configuration()).toThrow(
        'EMAIL_RECONCILE_BATCH_SIZE must be an integer between 1 and 1000',
      );
    });

    it('rejects a non-boolean EMAIL_RECONCILE_ENABLED', () => {
      process.env.EMAIL_RECONCILE_ENABLED = 'yes';

      expect(() => configuration()).toThrow('EMAIL_RECONCILE_ENABLED must be "true" or "false"');
    });

    it('parses explicit values, including disabled reconciliation', () => {
      process.env.EMAIL_MAX_ATTEMPTS = '8';
      process.env.EMAIL_RECONCILE_ENABLED = 'FALSE';
      process.env.EMAIL_RECONCILE_BATCH_SIZE = '50';
      process.env.EMAIL_RECONCILE_STALE_MINUTES = '3';

      const config = configuration();

      expect(config.notifications.email.maxAttempts).toBe(8);
      expect(config.notifications.email.reconcileEnabled).toBe(false);
      expect(config.notifications.email.reconcileBatchSize).toBe(50);
      expect(config.notifications.email.reconcileStaleMinutes).toBe(3);
    });
  });
});
