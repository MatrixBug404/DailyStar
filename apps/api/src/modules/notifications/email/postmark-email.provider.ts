import { EmailMessage, EmailProvider } from './email-provider.interface';

const POSTMARK_ENDPOINT = 'https://api.postmarkapp.com/email';
const POSTMARK_TIMEOUT_MS = 10_000;
const POSTMARK_TAG = 'dailystar-notification';

type FetchLike = typeof fetch;

interface PostmarkErrorPayload {
  ErrorCode?: unknown;
  Message?: unknown;
}

/**
 * Postmark adapter using Node 22's built-in `fetch` (Phase 8 spec §9.2).
 *
 * Security notes:
 * - The server token is only ever placed in the `X-Postmark-Server-Token`
 *   header and is scrubbed from every error message.
 * - Provider response bodies are never included in thrown errors; only the
 *   HTTP status and Postmark error code are surfaced.
 */
export class PostmarkEmailProvider implements EmailProvider {
  constructor(
    private readonly serverToken: string,
    private readonly from: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    let response: Response;

    try {
      response = await this.fetchImpl(POSTMARK_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Postmark-Server-Token': this.serverToken,
        },
        body: JSON.stringify({
          From: this.from,
          To: message.to,
          Subject: message.subject,
          TextBody: message.text,
          Tag: POSTMARK_TAG,
        }),
        signal: AbortSignal.timeout(POSTMARK_TIMEOUT_MS),
      });
    } catch (error: unknown) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new Error(`Postmark email request timed out after ${POSTMARK_TIMEOUT_MS}ms`);
      }

      const messageText = error instanceof Error ? error.message : String(error);
      throw new Error(`Postmark email request failed: ${this.redact(messageText)}`);
    }

    if (!response.ok) {
      let errorCode: unknown;
      try {
        const payload = (await response.json()) as PostmarkErrorPayload;
        errorCode = payload?.ErrorCode;
      } catch {
        // A malformed/non-JSON error body must never be surfaced verbatim.
      }

      const codeSuffix =
        typeof errorCode === 'number' || typeof errorCode === 'string'
          ? ` (ErrorCode ${errorCode})`
          : '';
      throw new Error(`Postmark email delivery failed with HTTP ${response.status}${codeSuffix}`);
    }
  }

  private redact(value: string): string {
    if (!this.serverToken) return value;
    return value.split(this.serverToken).join('[REDACTED]');
  }
}
