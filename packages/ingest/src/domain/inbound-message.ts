import { hashIdentifier } from "@watcher/core";

export type InboundMessageKind = "text" | "image" | "audio" | "unknown";

export interface InboundMedia {
  readonly url: string;
  /** Set once the file is in S3; the media repository owns the layout. */
  readonly key?: string;
  readonly mimeType?: string;
  readonly sizeBytes?: number;
}

export interface InboundMessageProps {
  readonly messageId: string;
  /** Canonical identity, E.164 when it could be normalized. Used as the partition key. */
  readonly from: string;
  /** Delivery address exactly as the provider gave it; replies must use this one. */
  readonly fromAddress: string;
  readonly kind: InboundMessageKind;
  readonly receivedAt: Date;
  readonly fromIsE164?: boolean;
  readonly fromCountry?: string;
  readonly text?: string;
  readonly media?: InboundMedia;
  readonly rawPayload?: unknown;
}

export class InboundMessage {
  readonly messageId: string;
  readonly from: string;
  readonly fromAddress: string;
  readonly kind: InboundMessageKind;
  readonly receivedAt: Date;
  readonly fromIsE164: boolean;
  readonly fromCountry?: string;
  readonly text?: string;
  readonly media?: InboundMedia;
  readonly rawPayload?: unknown;

  private constructor(props: InboundMessageProps) {
    this.messageId = props.messageId;
    this.from = props.from;
    this.fromAddress = props.fromAddress;
    this.kind = props.kind;
    this.receivedAt = props.receivedAt;
    this.fromIsE164 = props.fromIsE164 ?? false;
    this.fromCountry = props.fromCountry;
    this.text = props.text;
    this.media = props.media;
    this.rawPayload = props.rawPayload;
  }

  static create(props: InboundMessageProps): InboundMessage {
    if (props.messageId.trim() === "") {
      throw new Error("InboundMessage: messageId cannot be empty");
    }

    if (props.from.trim() === "") {
      throw new Error("InboundMessage: from cannot be empty");
    }

    return new InboundMessage(props);
  }

  hasMedia(): boolean {
    return this.media !== undefined;
  }

  toLogRecord(): Record<string, unknown> {
    return {
      messageId: this.messageId,
      fromHash: hashIdentifier(this.from),
      kind: this.kind,
      fromIsE164: this.fromIsE164,
      fromCountry: this.fromCountry,
      hasMedia: this.hasMedia(),
      mediaKey: this.media?.key,
      mediaMimeType: this.media?.mimeType,
      mediaSizeBytes: this.media?.sizeBytes,
      textLength: this.text?.length ?? 0,
      receivedAt: this.receivedAt.toISOString(),
    };
  }
}
