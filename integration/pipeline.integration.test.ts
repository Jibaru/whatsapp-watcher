import { randomUUID } from "node:crypto";
import { CloudWatchLogsClient, FilterLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetFunctionConfigurationCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { DeleteCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { hmacHex } from "@watcher/core";
import { afterAll, describe, expect, it } from "bun:test";
import { Resource } from "sst";

const apiUrl = Resource.WatcherApi.url;
const secret = Resource.KapsoWebhookSecret.value.trim();
const tableName = Resource.WatcherTable.name;
const logs = new CloudWatchLogsClient({});
const lambda = new LambdaClient({});

// SST gives the log group its own random suffix, so it cannot be derived from the
// function name: the function configuration is the only place that knows it.
async function processorLogGroup(): Promise<string> {
  const config = await lambda.send(
    new GetFunctionConfigurationCommand({ FunctionName: Resource.ProcessorFunction.name }),
  );

  const logGroup = config.LoggingConfig?.LogGroup;

  if (logGroup === undefined) {
    throw new Error("The processor has no log group configured");
  }

  return logGroup;
}

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const PARTITION = "USER#+51999000001";
const createdMessageIds: string[] = [];

afterAll(async () => {
  await Promise.all(
    createdMessageIds.map((messageId) =>
      dynamo.send(
        new DeleteCommand({ TableName: tableName, Key: { pk: PARTITION, sk: `RAW#${messageId}` } }),
      ),
    ),
  );
});

async function findInProcessorLogs(needle: string, since: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  const logGroup = await processorLogGroup();

  while (Date.now() < deadline) {
    const { events } = await logs.send(
      new FilterLogEventsCommand({
        logGroupName: logGroup,
        startTime: since,
        filterPattern: `"${needle}"`,
      }),
    );

    if (events !== undefined && events.length > 0) {
      return events;
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  return [];
}

/** Lambda prefixes each line with "timestamp	requestId	INFO	" before our JSON. */
function parseStructuredLine(message: string): Record<string, unknown> | undefined {
  const start = message.indexOf("{");

  if (start === -1) {
    return undefined;
  }

  try {
    return JSON.parse(message.slice(start)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

describe("ingest to processor, through the bus and the queue", () => {
  it(
    "delivers the note to the processor keeping the ingest correlation id",
    async () => {
      const messageId = `wamid.itest-${randomUUID()}`;
      createdMessageIds.push(messageId);
      const correlationId = `itest-${randomUUID()}`;
      const since = Date.now() - 60_000;

      const body = JSON.stringify({
        message: {
          id: messageId,
          type: "text",
          from: "999000001",
          from_user_id: "PE.1618166519838886",
          text: { body: "pipeline probe" },
          kapso: { direction: "inbound", status: "received", has_media: false },
        },
        conversation: { id: `conv-${messageId}`, phone_number: "999000001" },
      });

      const response = await fetch(`${apiUrl}/webhooks/kapso`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webhook-signature": hmacHex(secret, body),
          "x-correlation-id": correlationId,
        },
        body,
      });

      expect(response.status).toBe(200);

      const events = await findInProcessorLogs(messageId, since, 90_000);

      expect(events.length).toBeGreaterThan(0);

      const record = events
        .map((event) => parseStructuredLine(String(event.message)))
        .find((line) => line?.event === "note_processing_started");

      expect(record).toMatchObject({
        service: "processor",
        event: "note_processing_started",
        correlationId,
        messageId,
        kind: "text",
        hasMedia: false,
      });
    },
    120_000,
  );
});
