import type { Logger } from "@watcher/core";
import {
  OUTSIDE_WINDOW_CODE,
  OutsideCustomerServiceWindowError,
  WhatsAppRejectedError,
  WhatsAppUnavailableError,
} from "../domain/errors.js";
import type { OutboundMessage, WhatsAppSender } from "./whatsapp.sender.js";

export interface KapsoSenderOptions {
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly phoneNumberId: string;
}

type Fetch = typeof globalThis.fetch;

export class KapsoWhatsAppSender implements WhatsAppSender {
  constructor(
    private readonly options: KapsoSenderOptions,
    private readonly logger: Logger,
    private readonly fetchImpl: Fetch = globalThis.fetch,
  ) {}

  async send(message: OutboundMessage): Promise<void> {
    const url = `${this.options.apiUrl}/meta/whatsapp/v24.0/${this.options.phoneNumberId}/messages`;
    let response: Response;

    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": this.options.apiKey },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          // WhatsApp wants the number without the leading plus.
          to: message.to.replace(/^\+/, ""),
          type: "text",
          text: { body: message.body },
        }),
      });
    } catch (error) {
      throw new WhatsAppUnavailableError(error instanceof Error ? error.message : String(error));
    }

    const payload = await readBody(response);

    if (!response.ok) {
      throw this.toDomainError(response.status, payload, message.to);
    }

    this.logger.info("whatsapp_message_sent", {
      to: message.to,
      messageId: firstMessageId(payload),
    });
  }

  private toDomainError(status: number, payload: unknown, recipient: string): Error {
    if (metaErrorCode(payload) === OUTSIDE_WINDOW_CODE) {
      return new OutsideCustomerServiceWindowError(recipient);
    }

    // 429 and 5xx are the only ones another attempt can fix.
    if (status === 429 || status >= 500) {
      return new WhatsAppUnavailableError(`HTTP ${status}`);
    }

    return new WhatsAppRejectedError(status, JSON.stringify(payload).slice(0, 300));
  }
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function metaErrorCode(payload: unknown): number | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }

  const error = (payload as { error?: { code?: unknown } }).error;

  return typeof error?.code === "number" ? error.code : undefined;
}

function firstMessageId(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }

  const messages = (payload as { messages?: { id?: unknown }[] }).messages;
  const id = messages?.[0]?.id;

  return typeof id === "string" ? id : undefined;
}
