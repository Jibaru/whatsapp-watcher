import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { PutCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { Logger } from "@watcher/core";
import type { Note } from "../domain/note.js";

export interface Reminder {
  readonly pk: string;
  readonly sk: string;
  readonly alarmId: string;
  readonly dueAt: Date;
}

export interface ReminderRepository {
  save(note: Note): Promise<Reminder>;
}

export class DynamoReminderRepository implements ReminderRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly logger: Logger,
  ) {}

  async save(note: Note): Promise<Reminder> {
    // One reminder per message, so reprocessing the same note cannot schedule it twice.
    const alarmId = note.messageId;
    const dueAtEpoch = Math.floor(note.dueAt!.getTime() / 1000);
    const reminder = {
      pk: `USER#${note.owner}`,
      sk: `ALARM#${dueAtEpoch}#${alarmId}`,
      alarmId,
      dueAt: note.dueAt!,
    };

    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            pk: reminder.pk,
            sk: reminder.sk,
            entityType: "Reminder",
            alarmId,
            noteId: note.noteId,
            messageId: note.messageId,
            title: note.title,
            status: "PENDING",
            dueAtEpoch,
            gsi1pk: "ALARM#PENDING",
            gsi1sk: dueAtEpoch,
          },
          ConditionExpression: "attribute_not_exists(pk)",
        }),
      );
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) {
        throw error;
      }

      this.logger.info("reminder_already_exists", { alarmId });
    }

    return reminder;
  }
}
