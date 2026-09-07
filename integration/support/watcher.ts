import { randomUUID } from "node:crypto";
import { CloudWatchLogsClient, FilterLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetFunctionConfigurationCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { hmacHex } from "@watcher/core";
import { Resource } from "sst";

export const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const logs = new CloudWatchLogsClient({});
const lambda = new LambdaClient({});

/** Synthetic Peruvian mobile: normalizes to E.164 and belongs to nobody. */
export const TEST_PHONE = "999000001";
export const TEST_PARTITION = "USER#+51999000001";

// Trimmed on purpose: this stands in for KAPSO, which holds the clean value.
const secret = Resource.KapsoWebhookSecret.value.trim();

export function newMessageId(prefix: string): string {
  return `wamid.${prefix}-${randomUUID()}`;
}

export interface WebhookOptions {
  readonly text?: string;
  readonly correlationId?: string;
}

export async function sendWebhook(messageId: string, options: WebhookOptions = {}) {
  const body = JSON.stringify({
    message: {
      id: messageId,
      type: "text",
      from: TEST_PHONE,
      from_user_id: "PE.161816651983",
      ...(options.text === undefined ? {} : { text: { body: options.text } }),
      kapso: { direction: "inbound", status: "received", has_media: false },
    },
    conversation: { id: `conv-${messageId}`, phone_number: TEST_PHONE },
  });

  return fetch(`${Resource.WatcherApi.url}/webhooks/kapso`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-signature": hmacHex(secret, body),
      ...(options.correlationId === undefined
        ? {}
        : { "x-correlation-id": options.correlationId }),
    },
    body,
  });
}

export function readItem(sk: string) {
  return dynamo
    .send(
      new GetCommand({
        TableName: Resource.WatcherTable.name,
        Key: { pk: TEST_PARTITION, sk },
        ConsistentRead: true,
      }),
    )
    .then((result) => result.Item);
}

export async function waitForItem(
  sk: string,
  matches: (item: Record<string, unknown>) => boolean = () => true,
  timeoutMs = 90_000,
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const item = await readItem(sk);

    if (item !== undefined && matches(item)) {
      return item;
    }

    await sleep(3000);
  }

  return undefined;
}

export async function itemsWithPrefix(prefix: string, partition = TEST_PARTITION) {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: Resource.WatcherTable.name,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": partition, ":sk": prefix },
      ConsistentRead: true,
    }),
  );

  return result.Items ?? [];
}

export async function cleanUp(messageId: string, partition = TEST_PARTITION) {
  const alarms = await itemsWithPrefix("ALARM#", partition);
  const keys = [`RAW#${messageId}`, `NOTE#${messageId}`, ...alarms.map((item) => String(item.sk))];

  await Promise.all(
    keys.map((sk) =>
      dynamo.send(
        new DeleteCommand({ TableName: Resource.WatcherTable.name, Key: { pk: partition, sk } }),
      ),
    ),
  );
}

/** SST gives the log group its own suffix, so only the function knows where it writes. */
async function logGroupOf(functionName: string): Promise<string> {
  const config = await lambda.send(
    new GetFunctionConfigurationCommand({ FunctionName: functionName }),
  );

  return config.LoggingConfig!.LogGroup!;
}

export interface LogLine {
  readonly event?: string;
  readonly [key: string]: unknown;
}

/** Lambda prefixes each line with "timestamp\trequestId\tINFO\t" before the JSON. */
function parseLine(message: string): LogLine | undefined {
  const start = message.indexOf("{");

  if (start === -1) {
    return undefined;
  }

  try {
    return JSON.parse(message.slice(start, message.lastIndexOf("}") + 1)) as LogLine;
  } catch {
    return undefined;
  }
}

export async function waitForLogs(
  functionName: string,
  needle: string,
  until: (lines: LogLine[]) => boolean,
  timeoutMs = 120_000,
): Promise<LogLine[]> {
  const logGroupName = await logGroupOf(functionName);
  const startTime = Date.now() - 60_000;
  const deadline = Date.now() + timeoutMs;
  let lines: LogLine[] = [];

  while (Date.now() < deadline) {
    const { events } = await logs.send(
      new FilterLogEventsCommand({ logGroupName, startTime, filterPattern: `"${needle}"` }),
    );

    lines = (events ?? [])
      .map((event) => parseLine(String(event.message)))
      .filter((line): line is LogLine => line !== undefined);

    if (until(lines)) {
      return lines;
    }

    await sleep(4000);
  }

  return lines;
}

export function hasEvent(lines: LogLine[], event: string): boolean {
  return lines.some((line) => line.event === event);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
