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

export class MediaTooLargeError extends Error {
  constructor(
    readonly sizeBytes: number,
    readonly maxBytes: number,
  ) {
    super(`Media of ${sizeBytes} bytes exceeds the ${maxBytes} byte cap`);
    this.name = "MediaTooLargeError";
  }
}
