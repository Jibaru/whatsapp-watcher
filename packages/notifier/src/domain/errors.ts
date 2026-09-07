import { PermanentError, TransientError } from "@watcher/core";

/**
 * Meta's code for a message sent outside the 24 hour customer service window. Retrying is
 * pointless: reopening the conversation needs an approved template, not another attempt.
 */
export const OUTSIDE_WINDOW_CODE = 131047;

export class OutsideCustomerServiceWindowError extends PermanentError {
  constructor(readonly recipient: string) {
    super(
      "outside_customer_service_window",
      "The 24 hour window is closed; this needs an approved template",
    );
  }
}

export class WhatsAppRejectedError extends PermanentError {
  constructor(status: number, detail: string) {
    super("whatsapp_rejected", `KAPSO rejected the send with ${status}: ${detail}`);
  }
}

export class WhatsAppUnavailableError extends TransientError {
  constructor(detail: string) {
    super("whatsapp_unavailable", `KAPSO could not take the send right now: ${detail}`);
  }
}
