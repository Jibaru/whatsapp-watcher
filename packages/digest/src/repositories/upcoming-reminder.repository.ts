import { QueryCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { DigestReminder } from "../domain/daily-digest.js";

export interface UpcomingReminderRepository {
  findDueBetween(from: Date, to: Date): Promise<DigestReminder[]>;
}

const PAGE_LIMIT = 100;

export class DynamoUpcomingReminderRepository implements UpcomingReminderRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  /**
   * The same index the sweep reads, asked the other way round: not what is already late, but
   * what is about to be due. Only pending reminders carry the index attributes.
   */
  async findDueBetween(from: Date, to: Date): Promise<DigestReminder[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "AlarmDueIndex",
        KeyConditionExpression: "gsi1pk = :pending AND gsi1sk BETWEEN :from AND :to",
        ExpressionAttributeValues: {
          ":pending": "ALARM#PENDING",
          ":from": Math.floor(from.getTime() / 1000),
          ":to": Math.floor(to.getTime() / 1000),
        },
        Limit: PAGE_LIMIT,
      }),
    );

    return (result.Items ?? []).map((item) => ({
      alarmId: String(item.alarmId),
      title: String(item.title ?? ""),
      dueAt: new Date(Number(item.dueAtEpoch) * 1000),
    }));
  }
}
