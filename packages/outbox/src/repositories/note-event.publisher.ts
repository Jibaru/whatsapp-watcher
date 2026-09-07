import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import {
  NOTE_RECEIVED,
  WATCHER_EVENT_SOURCE,
  type Logger,
  type NoteReceivedDetail,
} from "@watcher/core";

export interface NoteEventPublisher {
  publishNoteReceived(detail: NoteReceivedDetail): Promise<void>;
}

export class EventBridgeNoteEventPublisher implements NoteEventPublisher {
  constructor(
    private readonly client: EventBridgeClient,
    private readonly busName: string,
    private readonly logger: Logger,
  ) {}

  async publishNoteReceived(detail: NoteReceivedDetail): Promise<void> {
    const response = await this.client.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: this.busName,
            Source: WATCHER_EVENT_SOURCE,
            DetailType: NOTE_RECEIVED,
            Detail: JSON.stringify(detail),
          },
        ],
      }),
    );

    // PutEvents answers 200 even when an entry is rejected; only this count tells the truth.
    if ((response.FailedEntryCount ?? 0) > 0) {
      const [entry] = response.Entries ?? [];

      throw new Error(`PutEvents rejected the entry: ${entry?.ErrorCode ?? "unknown"}`);
    }

    this.logger.info("note_received_published", { messageId: detail.messageId });
  }
}
