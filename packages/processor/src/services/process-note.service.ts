import type { Logger, NoteReceivedDetail } from "@watcher/core";

export interface ProcessNoteInput {
  readonly note: NoteReceivedDetail;
  readonly receiveCount: number;
}

export interface ProcessNoteOutput {
  readonly messageId: string;
}

/** Only logs for now: media download, Bedrock and the note write land here next. */
export class ProcessNoteService {
  constructor(private readonly logger: Logger) {}

  async execute(input: ProcessNoteInput): Promise<ProcessNoteOutput> {
    this.logger.info("note_processing_started", {
      messageId: input.note.messageId,
      kind: input.note.kind,
      hasMedia: input.note.hasMedia,
      mediaKey: input.note.mediaKey,
      receiveCount: input.receiveCount,
    });

    return { messageId: input.note.messageId };
  }
}
