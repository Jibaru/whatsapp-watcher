import type { Logger } from "@watcher/core";

export interface OutboundMessage {
  readonly to: string;
  readonly body: string;
  /** A reminder can fall outside the 24 hour window; a confirmation never does. */
  readonly kind: "confirmation" | "reminder";
}

export interface WhatsAppSender {
  send(message: OutboundMessage): Promise<void>;
}

/**
 * Stand-in until the KAPSO outbound credentials and the approved template exist. It logs
 * exactly what would go out, so the pipeline can be exercised without messaging anyone.
 */
export class LoggingWhatsAppSender implements WhatsAppSender {
  constructor(private readonly logger: Logger) {}

  async send(message: OutboundMessage): Promise<void> {
    this.logger.info("whatsapp_message_not_sent_yet", {
      sender: "logging",
      to: message.to,
      bodyLength: message.body.length,
    });
  }
}
