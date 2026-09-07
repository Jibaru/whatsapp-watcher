import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import {
  getLogContext,
  NOTE_FAILED,
  NOTE_PROCESSED,
  PROCESSOR_EVENT_SOURCE,
  TransientError,
  type Logger,
  type NoteFailedDetail,
  type NoteProcessedDetail,
} from "@watcher/core";

export type PublishNoteProcessedCommand = Omit<
  NoteProcessedDetail,
  "correlationId" | "conversationId"
>;

export type PublishNoteFailedCommand = Omit<NoteFailedDetail, "correlationId" | "conversationId">;

export interface NoteEventPublisher {
  publishNoteProcessed(command: PublishNoteProcessedCommand): Promise<void>;
  publishNoteFailed(command: PublishNoteFailedCommand): Promise<void>;
}

export class EventBridgeNoteEventPublisher implements NoteEventPublisher {
  constructor(
    private readonly client: EventBridgeClient,
    private readonly busName: string,
    private readonly logger: Logger,
  ) {}

  async publishNoteProcessed(command: PublishNoteProcessedCommand): Promise<void> {
    await this.publish(NOTE_PROCESSED, this.withTrace(command));

    this.logger.info("note_processed_published", { noteId: command.noteId });
  }

  async publishNoteFailed(command: PublishNoteFailedCommand): Promise<void> {
    await this.publish(NOTE_FAILED, this.withTrace(command));

    this.logger.warn("note_failed_published", { code: command.code });
  }

  private withTrace<T extends { messageId: string }>(command: T) {
    const context = getLogContext();

    return {
      ...command,
      correlationId: context?.correlationId ?? command.messageId,
      conversationId: context?.conversationId,
    };
  }

  private async publish(detailType: string, detail: unknown): Promise<void> {
    const response = await this.client.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: this.busName,
            Source: PROCESSOR_EVENT_SOURCE,
            DetailType: detailType,
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
  }
}
