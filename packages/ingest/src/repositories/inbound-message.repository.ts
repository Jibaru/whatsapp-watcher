import type { InboundMessage } from "../domain/inbound-message.js";

export interface SaveOutcome {
  readonly stored: boolean;
  /** True when the messageId was already there: writes are idempotent. */
  readonly duplicate: boolean;
  readonly pk: string;
  readonly sk: string;
}

export interface InboundMessageRepository {
  save(message: InboundMessage): Promise<SaveOutcome>;
}
