import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import {
  getLogContext,
  NOTE_PROCESSED,
  PROCESSOR_EVENT_SOURCE,
  TransientError,
  type Logger,
  type NoteProcessedDetail,
} from "@watcher/core";

export type PublishNoteProcessedCommand = Omit<
  NoteProcessedDetail,
  "correlationId" | "conversationId"
>;

export interface NoteEventPublisher {
  publishNoteProcessed(command: PublishNoteProcessedCommand): Promise<void>;
}

export class EventBridgeNoteEventPublisher implements NoteEventPublisher {
  constructor(
    private readonly client: EventBridgeClient,
    private readonly busName: string,
    private readonly logger: Logger,
  ) {}

  async publishNoteProcessed(command: PublishNoteProcessedCommand): Promise<void> {
    const context = getLogContext();

    const detail: NoteProcessedDetail = {
      ...command,
      correlationId: context?.correlationId ?? command.messageId,
      conversationId: context?.conversationId,
    };

    const response = await this.client.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: this.busName,
            Source: PROCESSOR_EVENT_SOURCE,
            DetailType: NOTE_PROCESSED,
            Detail: JSON.stringify(detail),
          },
        ],
      }),
    );

    // PutEvents answers 200 even when an entry is rejected; only this count tells the truth.
    if ((response.FailedEntryCount ?? 0) > 0) {
      const [entry] = response.Entries ?? [];

      throw new TransientError(
        "put_events_rejected",
        `PutEvents rejected the entry: ${entry?.ErrorCode ?? "unknown"}`,
      );
    }

    this.logger.info("note_processed_published", { noteId: detail.noteId });
  }
}
