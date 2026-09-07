import { randomUUID } from "node:crypto";
import { PhoneNumber, setLogContext, type Logger } from "@watcher/core";
import { InboundMessage, type InboundMedia, type InboundMessageKind } from "../domain/inbound-message.js";
import {
  MediaTooLargeError,
  type InboundMediaRepository,
} from "../repositories/inbound-media.repository.js";
import type { InboundMessageRepository } from "../repositories/inbound-message.repository.js";

export interface ReceiveInboundMessageInput {
  readonly messageId?: string;
  readonly from?: string;
  /** ISO alpha-2 hint; KAPSO carries it in the from_user_id prefix. */
  readonly fromCountryHint?: string;
  readonly kind?: string;
  readonly text?: string;
  readonly mediaUrl?: string;
  readonly mediaMimeType?: string;
  readonly mediaSizeBytes?: number;
  readonly receivedAt: Date;
  readonly rawPayload: unknown;
}

export interface ReceiveInboundMessageOutput {
  readonly messageId: string;
  readonly duplicate: boolean;
  readonly generatedMessageId: boolean;
}

export interface ReceiveInboundMessageOptions {
  /** Dumps the whole payload to discover the real KAPSO format. Off outside dev: it carries PII. */
  readonly logRawPayload: boolean;
  readonly newId?: () => string;
}

const KNOWN_KINDS = new Set<InboundMessageKind>(["text", "image", "audio"]);
const UNKNOWN_SENDER = "unknown";

export class ReceiveInboundMessageService {
  private readonly newId: () => string;

  constructor(
    private readonly repository: InboundMessageRepository,
    private readonly mediaRepository: InboundMediaRepository,
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

    const rawFrom = isBlank(input.from) ? undefined : input.from!.trim();
    const phone =
      rawFrom === undefined ? undefined : PhoneNumber.parse(rawFrom, input.fromCountryHint);

    if (rawFrom !== undefined && phone === undefined) {
      this.logger.warn("phone_not_normalized", {
        hasCountryHint: !isBlank(input.fromCountryHint),
        rawLength: rawFrom.length,
      });
    }

    const messageId = generatedMessageId ? this.newId() : input.messageId!.trim();
    const media = await this.storeMedia(messageId, input);

    const message = InboundMessage.create({
      messageId,
      from: phone?.e164 ?? rawFrom ?? UNKNOWN_SENDER,
      fromAddress: rawFrom ?? UNKNOWN_SENDER,
      fromIsE164: phone !== undefined,
      fromCountry: phone?.country,
      kind: normalizeKind(input.kind),
      receivedAt: input.receivedAt,
      text: input.text,
      media,
      rawPayload: input.rawPayload,
    });

    setLogContext({ messageId: message.messageId });

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

  /**
   * Runs before the message is written: the KAPSO url is short lived, so a note that lands
   * in the DLQ hours later must still find its file (docs/ENUNCIADO.md, 6.1).
   */
  private async storeMedia(
    messageId: string,
    input: ReceiveInboundMessageInput,
  ): Promise<InboundMedia | undefined> {
    if (input.mediaUrl === undefined) {
      return undefined;
    }

    try {
      const stored = await this.mediaRepository.store({
        sourceUrl: input.mediaUrl,
        messageId,
        declaredSizeBytes: input.mediaSizeBytes,
        contentType: input.mediaMimeType,
      });

      return {
        url: input.mediaUrl,
        key: stored.key,
        mimeType: stored.contentType,
        sizeBytes: stored.sizeBytes,
      };
    } catch (error) {
      // Oversized media can never succeed, so keep the note and drop the file instead of
      // failing the webhook into an endless retry. Anything else is transient: let it throw.
      if (error instanceof MediaTooLargeError) {
        this.logger.warn("media_too_large", {
          sizeBytes: error.sizeBytes,
          maxBytes: error.maxBytes,
        });

        return undefined;
      }

      throw error;
    }
  }
}

function normalizeKind(kind: string | undefined): InboundMessageKind {
  const candidate = kind?.trim().toLowerCase() as InboundMessageKind | undefined;

  return candidate !== undefined && KNOWN_KINDS.has(candidate) ? candidate : "unknown";
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}
