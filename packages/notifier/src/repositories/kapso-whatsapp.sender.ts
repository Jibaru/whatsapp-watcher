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
  /** Approved template with a single body variable. Empty until one exists in KAPSO. */
  readonly reminderTemplate: string;
  readonly templateLanguage: string;
}

type Fetch = typeof globalThis.fetch;

export class KapsoWhatsAppSender implements WhatsAppSender {
  constructor(
    private readonly options: KapsoSenderOptions,
    private readonly logger: Logger,
    private readonly fetchImpl: Fetch = globalThis.fetch,
  ) {}

  async send(message: OutboundMessage): Promise<void> {
    try {
      await this.post(textPayload(message));
    } catch (error) {
      if (!(error instanceof OutsideCustomerServiceWindowError) || !this.canUseTemplate(message)) {
        throw error;
      }

      // A reminder that fires the next day is outside the window by definition; only an
      // approved template can reopen the conversation.
      this.logger.info("falling_back_to_template", { template: this.options.reminderTemplate });

      await this.post(
        templatePayload(message, this.options.reminderTemplate, this.options.templateLanguage),
      );
    }
  }

  private canUseTemplate(message: OutboundMessage): boolean {
    return message.kind === "reminder" && this.options.reminderTemplate !== "";
  }

  private async post(payload: Record<string, unknown>): Promise<void> {
    const url = `${this.options.apiUrl}/meta/whatsapp/v24.0/${this.options.phoneNumberId}/messages`;
    let response: Response;

    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": this.options.apiKey },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      throw new WhatsAppUnavailableError(error instanceof Error ? error.message : String(error));
    }

    const body = await readBody(response);

    if (!response.ok) {
      throw this.toDomainError(response.status, body, String(payload.to));
    }

    this.logger.info("whatsapp_message_sent", {
      to: payload.to,
      type: payload.type,
      messageId: firstMessageId(body),
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

/** WhatsApp does not take the leading plus in the recipient. */
function recipientOf(message: OutboundMessage): string {
  return message.to.replace(/^\+/, "");
}

function textPayload(message: OutboundMessage): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: recipientOf(message),
    type: "text",
    text: { body: message.body },
  };
}

function templatePayload(
  message: OutboundMessage,
  name: string,
  language: string,
): Record<string, unknown> {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: recipientOf(message),
    type: "template",
    template: {
      name,
      language: { code: language },
      components: [{ type: "body", parameters: [{ type: "text", text: message.body }] }],
    },
  };
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
