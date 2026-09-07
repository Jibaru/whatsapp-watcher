import { hashIdentifier } from "../lib/hash.js";

export type InboundMessageKind = "text" | "image" | "audio" | "unknown";

export interface InboundMedia {
  readonly url: string;
  readonly mimeType?: string;
}

export interface InboundMessageProps {
  readonly messageId: string;
  readonly from: string;
  readonly kind: InboundMessageKind;
  readonly receivedAt: Date;
  readonly text?: string;
  readonly media?: InboundMedia;
}

/**
 * Mensaje que entra por WhatsApp, ya normalizado. No sabe nada de KAPSO ni de HTTP:
 * el mapeo desde el payload vive en la capa de handler.
 */
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
      throw new Error("InboundMessage: messageId no puede estar vacío");
    }

    if (props.from.trim() === "") {
      throw new Error("InboundMessage: from no puede estar vacío");
    }

    return new InboundMessage(props);
  }

  hasMedia(): boolean {
    return this.media !== undefined;
  }

  /** Clave del objeto en S3 cuando el media se guarde en la ingesta. */
  mediaKey(stage: string): string | undefined {
    return this.hasMedia() ? `${stage}/${this.messageId}` : undefined;
  }

  /** Proyección segura para logs: sin teléfono en claro y sin el cuerpo del mensaje. */
  toLogRecord(): Record<string, unknown> {
    return {
      messageId: this.messageId,
      fromHash: hashIdentifier(this.from),
      kind: this.kind,
      hasMedia: this.hasMedia(),
      textLength: this.text?.length ?? 0,
      receivedAt: this.receivedAt.toISOString(),
    };
  }
}
