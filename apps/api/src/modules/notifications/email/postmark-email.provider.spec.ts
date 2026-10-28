import { PostmarkEmailProvider } from './postmark-email.provider';

const TOKEN = 'postmark-secret-token-value';
const FROM = 'DailyStar <notifications@dailystar.local>';

function jsonResponse(status: number, body: unknown, ok = status >= 200 && status < 300): Response {
  return {
    ok,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('PostmarkEmailProvider', () => {
  const message = {
    to: 'recipient@dailystar.local',
    subject: '[DailyStar] Article approved',
    text: 'Plain text body',
    notificationId: 'notification-1',
  };

  it('posts the documented payload with the server token header', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(200, { ErrorCode: 0 }));
    const provider = new PostmarkEmailProvider(TOKEN, FROM, fetchMock as unknown as typeof fetch);

    await expect(provider.send(message)).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.postmarkapp.com/email');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Postmark-Server-Token': TOKEN,
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toEqual({
      From: FROM,
      To: message.to,
      Subject: message.subject,
      TextBody: message.text,
      Tag: 'dailystar-notification',
    });
  });

  it('throws the HTTP status and Postmark error code on a 4xx response without leaking secrets', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(422, { ErrorCode: 300, Message: `rejected token ${TOKEN}` }, false),
      );
    const provider = new PostmarkEmailProvider(TOKEN, FROM, fetchMock as unknown as typeof fetch);

    const error = await provider.send(message).catch((caught: Error) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('HTTP 422');
    expect((error as Error).message).toContain('ErrorCode 300');
    expect((error as Error).message).not.toContain(TOKEN);
    expect((error as Error).message).not.toContain('rejected token');
  });

  it('throws on 5xx responses', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(503, { ErrorCode: 10 }, false));
    const provider = new PostmarkEmailProvider(TOKEN, FROM, fetchMock as unknown as typeof fetch);

    await expect(provider.send(message)).rejects.toThrow('HTTP 503');
  });

  it('tolerates a non-JSON error body without exposing it', async () => {
    const response = {
      ok: false,
      status: 500,
      json: jest.fn().mockRejectedValue(new Error('invalid json')),
    } as unknown as Response;
    const provider = new PostmarkEmailProvider(
      TOKEN,
      FROM,
      jest.fn().mockResolvedValue(response) as unknown as typeof fetch,
    );

    await expect(provider.send(message)).rejects.toThrow(
      'Postmark email delivery failed with HTTP 500',
    );
  });

  it('reports a timeout without network details', async () => {
    const timeout = new Error('The operation was aborted');
    timeout.name = 'TimeoutError';
    const fetchMock = jest.fn().mockRejectedValue(timeout);
    const provider = new PostmarkEmailProvider(TOKEN, FROM, fetchMock as unknown as typeof fetch);

    await expect(provider.send(message)).rejects.toThrow(
      'Postmark email request timed out after 10000ms',
    );
  });

  it('redacts the server token from transport error messages', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValue(new Error(`socket failed while sending token ${TOKEN}`));
    const provider = new PostmarkEmailProvider(TOKEN, FROM, fetchMock as unknown as typeof fetch);

    const error = await provider.send(message).catch((caught: Error) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('[REDACTED]');
    expect((error as Error).message).not.toContain(TOKEN);
  });
});
