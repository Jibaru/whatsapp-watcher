import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { PutCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { getLogContext, type Logger } from "@watcher/core";
import type { InboundMessage } from "../domain/inbound-message.js";
import type { InboundMessageRepository, SaveOutcome } from "./inbound-message.repository.js";

export class DynamoInboundMessageRepository implements InboundMessageRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly logger: Logger,
  ) {}

  async save(message: InboundMessage): Promise<SaveOutcome> {
    // The outbox reads the trace from the item: with no publish step, this is the only
    // place where the request that created it can still be recorded.
    const context = getLogContext();

    const item = {
      pk: `USER#${message.from}`,
      sk: `RAW#${message.messageId}`,
      entityType: "InboundMessage",
      correlationId: context?.correlationId,
      conversationId: context?.conversationId,
      messageId: message.messageId,
      from: message.from,
      fromAddress: message.fromAddress,
      fromIsE164: message.fromIsE164,
      fromCountry: message.fromCountry,
      kind: message.kind,
      text: message.text,
      mediaKey: message.media?.key,
      mediaMimeType: message.media?.mimeType,
      mediaSizeBytes: message.media?.sizeBytes,
      receivedAtEpoch: Math.floor(message.receivedAt.getTime() / 1000),
      payload: message.rawPayload,
    };

    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: "attribute_not_exists(pk)",
        }),
      );
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        this.logger.info("inbound_message_duplicate", { pk: item.pk, sk: item.sk });

        return { stored: false, duplicate: true, pk: item.pk, sk: item.sk };
      }

      throw error;
    }

    this.logger.info("inbound_message_persisted", { pk: item.pk, sk: item.sk });

    return { stored: true, duplicate: false, pk: item.pk, sk: item.sk };
  }
}
