import { PermanentError } from "@watcher/core";

export interface StoreMediaCommand {
  readonly sourceUrl: string;
  readonly messageId: string;
  readonly declaredSizeBytes?: number;
  readonly contentType?: string;
}

export interface StoredMedia {
  readonly key: string;
  readonly sizeBytes: number;
  readonly contentType?: string;
}

export interface InboundMediaRepository {
  store(command: StoreMediaCommand): Promise<StoredMedia>;
}

/** Retrying cannot shrink the file, so the note is kept and the media dropped. */
export class MediaTooLargeError extends PermanentError {
  constructor(
    readonly sizeBytes: number,
    readonly maxBytes: number,
  ) {
    super("media_too_large", `Media of ${sizeBytes} bytes exceeds the ${maxBytes} byte cap`);
  }
}
