import type { InboundMessage } from "../domain/inbound-message.js";

export interface SaveOutcome {
  /** false cuando el messageId ya existía: la escritura es idempotente. */
  readonly stored: boolean;
  readonly duplicate: boolean;
}

export interface InboundMessageRepository {
  save(message: InboundMessage): Promise<SaveOutcome>;
}
