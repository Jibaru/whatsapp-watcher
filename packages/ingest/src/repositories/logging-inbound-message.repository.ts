import type { Logger } from "@watcher/core";
import type { InboundMessage } from "../domain/inbound-message.js";
import type { InboundMessageRepository, SaveOutcome } from "./inbound-message.repository.js";

/** Stand-in until the DynamoDB repository lands: it only leaves a trace in CloudWatch. */
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
