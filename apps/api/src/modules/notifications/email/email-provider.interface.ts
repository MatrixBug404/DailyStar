/**
 * Email delivery provider abstraction (Phase 8 spec §9.1).
 *
 * Implementations must never log or return the provider token, and must throw
 * plain errors containing only status/code-level diagnostics — never message
 * bodies, headers or credentials.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** Correlation id for structured logs; not sent to the provider API. */
  notificationId?: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
