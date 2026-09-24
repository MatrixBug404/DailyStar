import configuration from './configuration';

describe('configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
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
});
