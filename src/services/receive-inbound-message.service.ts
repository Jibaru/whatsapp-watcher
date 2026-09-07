import { randomUUID } from "node:crypto";
import { InboundMessage, type InboundMessageKind } from "../domain/inbound-message.js";
import type { Logger } from "../lib/logger.js";
import type { InboundMessageRepository } from "../repositories/inbound-message.repository.js";

/** DTO de entrada: lo que el handler saca del webhook, ya desacoplado de HTTP. */
export interface ReceiveInboundMessageInput {
  readonly messageId?: string;
  readonly from?: string;
  readonly kind?: string;
  readonly text?: string;
  readonly mediaUrl?: string;
  readonly mediaMimeType?: string;
  readonly receivedAt: Date;
  readonly rawPayload: unknown;
}

/** DTO de salida: lo que el handler necesita para responder. */
export interface ReceiveInboundMessageOutput {
  readonly messageId: string;
  readonly duplicate: boolean;
  /** true cuando el payload no traía identificador y hubo que inventarlo. */
  readonly generatedMessageId: boolean;
}

export interface ReceiveInboundMessageOptions {
  /** En dev se vuelca el payload entero para descubrir el formato real de KAPSO. */
  readonly logRawPayload: boolean;
  readonly newId?: () => string;
}

const KNOWN_KINDS = new Set<InboundMessageKind>(["text", "image", "audio"]);
const UNKNOWN_SENDER = "unknown";

export class ReceiveInboundMessageService {
  private readonly newId: () => string;

  constructor(
    private readonly repository: InboundMessageRepository,
    private readonly logger: Logger,
    private readonly options: ReceiveInboundMessageOptions,
  ) {
    this.newId = options.newId ?? randomUUID;
  }

  async execute(input: ReceiveInboundMessageInput): Promise<ReceiveInboundMessageOutput> {
    if (this.options.logRawPayload) {
      this.logger.info("kapso_webhook_raw_payload", { payload: input.rawPayload });
    }

    const generatedMessageId = isBlank(input.messageId);

    if (generatedMessageId || isBlank(input.from)) {
      this.logger.warn("kapso_payload_incomplete", {
        hasMessageId: !generatedMessageId,
        hasFrom: !isBlank(input.from),
      });
    }

    const message = InboundMessage.create({
      messageId: generatedMessageId ? this.newId() : input.messageId!.trim(),
      from: isBlank(input.from) ? UNKNOWN_SENDER : input.from!.trim(),
      kind: normalizeKind(input.kind),
      receivedAt: input.receivedAt,
      text: input.text,
      media: input.mediaUrl
        ? { url: input.mediaUrl, mimeType: input.mediaMimeType }
        : undefined,
    });

    const outcome = await this.repository.save(message);

    this.logger.info("inbound_message_received", {
      ...message.toLogRecord(),
      duplicate: outcome.duplicate,
      generatedMessageId,
    });

    return {
      messageId: message.messageId,
      duplicate: outcome.duplicate,
      generatedMessageId,
    };
  }
}

function normalizeKind(kind: string | undefined): InboundMessageKind {
  const candidate = kind?.trim().toLowerCase() as InboundMessageKind | undefined;

  return candidate !== undefined && KNOWN_KINDS.has(candidate) ? candidate : "unknown";
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}
