import { GetCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SourceMessageNotFoundError } from "../domain/errors.js";

export interface SourceMessage {
  readonly messageId: string;
  readonly from: string;
  readonly fromAddress: string;
  readonly kind: string;
  readonly text?: string;
  readonly mediaKey?: string;
  readonly mediaMimeType?: string;
  readonly fromCountry?: string;
}

export interface InboundMessageReader {
  read(pk: string, sk: string): Promise<SourceMessage>;
}

export class DynamoInboundMessageReader implements InboundMessageReader {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async read(pk: string, sk: string): Promise<SourceMessage> {
    const { Item } = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { pk, sk } }),
    );

    if (Item === undefined) {
      throw new SourceMessageNotFoundError(pk, sk);
    }

    return {
      messageId: String(Item.messageId),
      from: String(Item.from),
      fromAddress: asString(Item.fromAddress) ?? String(Item.from),
      kind: String(Item.kind ?? "unknown"),
      text: asString(Item.text),
      mediaKey: asString(Item.mediaKey),
      mediaMimeType: asString(Item.mediaMimeType),
      fromCountry: asString(Item.fromCountry),
    };
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
