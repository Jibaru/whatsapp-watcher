import { hashIdentifier } from "@watcher/core";

export type InboundMessageKind = "text" | "image" | "audio" | "unknown";

export interface InboundMedia {
  readonly url: string;
  readonly mimeType?: string;
  readonly sizeBytes?: number;
}

export interface InboundMessageProps {
  readonly messageId: string;
  readonly from: string;
  readonly kind: InboundMessageKind;
  readonly receivedAt: Date;
  readonly text?: string;
  readonly media?: InboundMedia;
}

export class InboundMessage {
  readonly messageId: string;
  readonly from: string;
  readonly kind: InboundMessageKind;
  readonly receivedAt: Date;
  readonly text?: string;
  readonly media?: InboundMedia;

  private constructor(props: InboundMessageProps) {
    this.messageId = props.messageId;
    this.from = props.from;
    this.kind = props.kind;
    this.receivedAt = props.receivedAt;
    this.text = props.text;
    this.media = props.media;
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

  mediaKey(stage: string): string | undefined {
    return this.hasMedia() ? `${stage}/${this.messageId}` : undefined;
  }

  toLogRecord(): Record<string, unknown> {
    return {
      messageId: this.messageId,
      fromHash: hashIdentifier(this.from),
      kind: this.kind,
      hasMedia: this.hasMedia(),
      mediaMimeType: this.media?.mimeType,
      mediaSizeBytes: this.media?.sizeBytes,
      textLength: this.text?.length ?? 0,
      receivedAt: this.receivedAt.toISOString(),
    };
  }
}
