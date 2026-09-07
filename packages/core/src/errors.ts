/**
 * The pipeline is at-least-once, so the only question an error has to answer is whether
 * trying again could change the outcome. Everything else is detail.
 */
export abstract class WatcherError extends Error {
  abstract readonly retryable: boolean;

  constructor(
    readonly code: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = new.target.name;

    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

/** Throttling, timeouts, a dependency that was momentarily down. Retry it. */
export class TransientError extends WatcherError {
  readonly retryable = true;
}

/** A bad payload, unsupported media, a missing record. It will fail the same way forever. */
export class PermanentError extends WatcherError {
  readonly retryable = false;
}

/**
 * An unknown error is treated as retryable: after the attempts run out it lands in the DLQ,
 * where a person sees it. Swallowing it silently would be worse.
 */
export function isRetryable(error: unknown): boolean {
  return error instanceof WatcherError ? error.retryable : true;
}

function describeCause(cause: unknown): Record<string, unknown> {
  return cause instanceof Error
    ? { name: cause.name, message: cause.message }
    : { message: String(cause) };
}

export function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof WatcherError) {
    return {
      code: error.code,
      name: error.name,
      message: error.message,
      retryable: error.retryable,
      // Without this the wrapper hides what actually went wrong underneath.
      cause: error.cause === undefined ? undefined : describeCause(error.cause),
    };
  }

  if (error instanceof Error) {
    return { name: error.name, message: error.message, retryable: true };
  }

  return { name: "Unknown", message: String(error), retryable: true };
}
