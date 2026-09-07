import type { Logger, NoteReceivedDetail } from "@watcher/core";
import type { NoteEventPublisher } from "../repositories/note-event.publisher.js";

export interface PublishNoteReceivedInput {
  readonly item: Record<string, unknown>;
}

export interface PublishNoteReceivedOutput {
  readonly published: boolean;
  readonly messageId?: string;
}

export class PublishNoteReceivedService {
  constructor(
    private readonly publisher: NoteEventPublisher,
    private readonly logger: Logger,
  ) {}

  async execute(input: PublishNoteReceivedInput): Promise<PublishNoteReceivedOutput> {
    const detail = toDetail(input.item);

    if (detail === undefined) {
      // Never throw on a record we cannot read: retrying it forever would block the shard.
      this.logger.warn("outbox_item_not_publishable", { keys: Object.keys(input.item) });

      return { published: false };
    }

    await this.publisher.publishNoteReceived(detail);

    return { published: true, messageId: detail.messageId };
  }
}

function toDetail(item: Record<string, unknown>): NoteReceivedDetail | undefined {
  const messageId = asString(item.messageId);
  const pk = asString(item.pk);
  const sk = asString(item.sk);
  const from = asString(item.from);

  if (messageId === undefined || pk === undefined || sk === undefined || from === undefined) {
    return undefined;
  }

  const mediaKey = asString(item.mediaKey);
  const receivedAtEpoch = Number(item.receivedAtEpoch ?? 0);

  return {
    correlationId: asString(item.correlationId) ?? messageId,
    conversationId: asString(item.conversationId),
    messageId,
    pk,
    sk,
    from,
    kind: asString(item.kind) ?? "unknown",
    hasMedia: mediaKey !== undefined,
    mediaKey,
    receivedAt: new Date(receivedAtEpoch * 1000).toISOString(),
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}
