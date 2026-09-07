import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { GetCommand, UpdateCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { Logger } from "@watcher/core";

export interface ReminderRepository {
  isPending(pk: string, sk: string): Promise<boolean>;
  markSent(pk: string, sk: string): Promise<void>;
  markUndeliverable(pk: string, sk: string, reason: string): Promise<void>;
}

export class DynamoReminderRepository implements ReminderRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly logger: Logger,
  ) {}

  async isPending(pk: string, sk: string): Promise<boolean> {
    const { Item } = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { pk, sk }, ConsistentRead: true }),
    );

    return Item?.status === "PENDING";
  }

  /**
   * The REMOVE is not cosmetic: AlarmDueIndex only holds what is still owed, and the sweep
   * trusts that. A sent reminder left in it comes back on every sweep forever, because expire()
   * will not touch something that is no longer PENDING.
   */
  async markSent(pk: string, sk: string): Promise<void> {
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk },
          UpdateExpression: "SET #status = :sent, sentAtEpoch = :now REMOVE gsi1pk, gsi1sk",
          ConditionExpression: "#status = :pending",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":sent": "SENT",
            ":pending": "PENDING",
            ":now": Math.floor(Date.now() / 1000),
          },
        }),
      );
    } catch (error) {
      // Someone else already marked it. The message went out either way, so this is not a failure.
      if (error instanceof ConditionalCheckFailedException) {
        this.logger.warn("reminder_already_marked", { pk, sk });

        return;
      }

      throw error;
    }
  }

  /**
   * A terminal state of its own. EXPIRED means nobody wants it any more; this means somebody
   * did and WhatsApp would not carry it, which is a different thing to read a week later.
   */
  async markUndeliverable(pk: string, sk: string, reason: string): Promise<void> {
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk, sk },
        UpdateExpression:
          "SET #status = :undeliverable, undeliverableReason = :reason, failedAtEpoch = :now" +
          " REMOVE gsi1pk, gsi1sk",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":undeliverable": "UNDELIVERABLE",
          ":reason": reason,
          ":now": Math.floor(Date.now() / 1000),
        },
      }),
    );

    this.logger.warn("reminder_undeliverable", { pk, sk, reason });
  }
}
