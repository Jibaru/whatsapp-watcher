import { PermanentError, TransientError } from "@watcher/core";

export class SourceMessageNotFoundError extends PermanentError {
  constructor(pk: string, sk: string) {
    super("source_message_not_found", `No item at ${pk} / ${sk}`);
  }
}

/** No Claude model on Bedrock accepts audio yet; voice notes need Transcribe first. */
export class UnsupportedMediaError extends PermanentError {
  constructor(readonly kind: string) {
    super("unsupported_media", `Cannot analyze media of kind "${kind}" yet`);
  }
}

export class ModelUnavailableError extends TransientError {
  constructor(cause: unknown) {
    super("model_unavailable", "Bedrock rejected the call and it is worth retrying", { cause });
  }
}

/** Access denied, a bad model id, a malformed request: retrying changes nothing. */
export class ModelRejectedError extends PermanentError {
  constructor(reason: string, cause: unknown) {
    super("model_rejected", `Bedrock rejected the call for good: ${reason}`, { cause });
  }
}

export class ModelOutputInvalidError extends PermanentError {
  constructor(reason: string) {
    super("model_output_invalid", `The model answered something unusable: ${reason}`);
  }
}
