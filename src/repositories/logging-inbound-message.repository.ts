import type { InboundMessage } from "../domain/inbound-message.js";
import type { Logger } from "../lib/logger.js";
import type { InboundMessageRepository, SaveOutcome } from "./inbound-message.repository.js";

/**
 * Implementación de arranque: no persiste, solo deja rastro en CloudWatch.
 * La sustituye DynamoInboundMessageRepository sin tocar el service ni el handler.
 */
export class LoggingInboundMessageRepository implements InboundMessageRepository {
  constructor(private readonly logger: Logger) {}

  async save(message: InboundMessage): Promise<SaveOutcome> {
    this.logger.info("inbound_message_persisted", {
      repository: "logging",
      message: message.toLogRecord(),
    });

    return { stored: true, duplicate: false };
  }
}
