import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { QueryCommand, UpdateCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { Logger } from "@watcher/core";

export interface DueReminder {
  readonly pk: string;
  readonly sk: string;
  readonly alarmId: string;
  readonly noteId: string;
  readonly messageId: string;
  readonly owner: string;
  readonly title: string;
  readonly dueAtEpoch: number;
  /** What the item itself says. The index can disagree, and then the item wins. */
  readonly status: string;
  readonly correlationId?: string;
}

export interface DueReminderRepository {
  findPendingBefore(epoch: number, limit: number): Promise<DueReminder[]>;
  expire(pk: string, sk: string): Promise<void>;
  unindex(pk: string, sk: string): Promise<void>;
}

export class DynamoDueReminderRepository implements DueReminderRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly logger: Logger,
  ) {}

  /**
   * Reads the index instead of scanning: every pending reminder lives under one partition
   * key ordered by its due time, so this only touches what is actually late.
   */
  async findPendingBefore(epoch: number, limit: number): Promise<DueReminder[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "AlarmDueIndex",
        KeyConditionExpression: "gsi1pk = :pending AND gsi1sk <= :epoch",
        ExpressionAttributeValues: { ":pending": "ALARM#PENDING", ":epoch": epoch },
        Limit: limit,
      }),
    );

    return (result.Items ?? []).map((item) => ({
      pk: String(item.pk),
      sk: String(item.sk),
      alarmId: String(item.alarmId),
      noteId: String(item.noteId),
      messageId: String(item.messageId),
      owner: String(item.pk).replace(/^USER#/, ""),
      title: String(item.title ?? ""),
      dueAtEpoch: Number(item.dueAtEpoch),
      status: String(item.status ?? ""),
      correlationId: typeof item.correlationId === "string" ? item.correlationId : undefined,
    }));
  }

  /** A terminal state, so a reminder nobody wants any more stops coming back every sweep. */
  async expire(pk: string, sk: string): Promise<void> {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk },
          UpdateExpression: "SET #status = :expired, expiredAtEpoch = :now REMOVE gsi1pk, gsi1sk",
          ConditionExpression: "#status = :pending",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":expired": "EXPIRED",
            ":pending": "PENDING",
            ":now": Math.floor(Date.now() / 1000),
          },
        }),
      );
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        // It left PENDING by another path. Its state is not ours to change, but it must still
        // leave the index, or the sweep keeps finding it every five minutes for good.
        await this.unindex(pk, sk);
        this.logger.info("reminder_no_longer_pending", { pk, sk });

        return;
      }

      throw error;
    }
  }

  /** Leaving the index is unconditional: whatever the item became, it is no longer owed. */
  async unindex(pk: string, sk: string): Promise<void> {
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk, sk },
        UpdateExpression: "REMOVE gsi1pk, gsi1sk",
      }),
    );
  }
}
