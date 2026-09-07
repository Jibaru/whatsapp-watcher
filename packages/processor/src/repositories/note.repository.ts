import { PutCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { noteDayPartition, type Logger } from "@watcher/core";
import type { Note } from "../domain/note.js";

export interface NoteRepository {
  save(note: Note): Promise<void>;
}

export class DynamoNoteRepository implements NoteRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly logger: Logger,
    private readonly timeZone: string,
  ) {}

  async save(note: Note): Promise<void> {
    // Keyed by messageId, not by a fresh id: reprocessing the same message overwrites its
    // note instead of creating a second one. SQS delivers at least once.
    const item = {
      pk: `USER#${note.owner}`,
      sk: `NOTE#${note.messageId}`,
      entityType: "Note",
      noteId: note.noteId,
      messageId: note.messageId,
      title: note.title,
      summary: note.summary,
      tags: note.tags,
      priority: note.priority,
      confidence: note.confidence,
      mediaKey: note.mediaKey,
      status: "OPEN",
      createdAtEpoch: Math.floor(note.createdAt.getTime() / 1000),
      dueAtEpoch: note.dueAt === undefined ? undefined : Math.floor(note.dueAt.getTime() / 1000),
      // NoteDigestIndex: the digest asks for one local day at a time, so it never reads the
      // whole history to summarise the last 24 hours.
      gsi2pk: noteDayPartition(note.createdAt, this.timeZone),
      gsi2sk: Math.floor(note.createdAt.getTime() / 1000),
    };

    await this.client.send(new PutCommand({ TableName: this.tableName, Item: item }));

    this.logger.info("note_persisted", { pk: item.pk, sk: item.sk });
  }
}
