import { UpdateCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { Logger } from "@watcher/core";

export interface FailedMessageRepository {
  markFailed(pk: string, sk: string, code: string, reason: string): Promise<void>;
}

export class DynamoFailedMessageRepository implements FailedMessageRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly logger: Logger,
  ) {}

  async markFailed(pk: string, sk: string, code: string, reason: string): Promise<void> {
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk, sk },
        UpdateExpression:
          "SET #status = :failed, failureCode = :code, failureReason = :reason, failedAtEpoch = :now",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":failed": "FAILED",
          ":code": code,
          ":reason": reason.slice(0, 500),
          ":now": Math.floor(Date.now() / 1000),
        },
      }),
    );

    this.logger.warn("inbound_message_failed", { pk, sk, code });
  }
}
