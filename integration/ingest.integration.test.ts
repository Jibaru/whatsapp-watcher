import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { HeadObjectCommand, DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { hmacHex } from "@watcher/core";
import { afterAll, describe, expect, it } from "bun:test";
import { Resource } from "sst";

const apiUrl = Resource.WatcherApi.url;
// Trimmed on purpose: this stands in for KAPSO, which holds the clean value. The lambda
// trims too, so a stray character in the stored secret must not make the suite lie.
const secret = Resource.KapsoWebhookSecret.value.trim();
const tableName = Resource.WatcherTable.name;
const bucketName = Resource.MediaBucket.name;

const s3 = new S3Client({});
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const PHONE = "999000001";
const PARTITION = "USER#+51999000001";
const TIMEOUT = 30_000;

const created: { messageIds: string[]; keys: string[] } = { messageIds: [], keys: [] };

function newMessageId(): string {
  const id = `wamid.itest-${randomUUID()}`;
  created.messageIds.push(id);

  return id;
}

function payload(messageId: string, overrides: Record<string, unknown> = {}) {
  return {
    message: {
      id: messageId,
      type: "text",
      from: PHONE,
      from_user_id: "PE.1618166519838886",
      text: { body: "integration probe" },
      kapso: { direction: "inbound", status: "received", has_media: false },
      ...overrides,
    },
    conversation: { id: `conv-${messageId}`, phone_number: PHONE },
    phone_number_id: "597907523413541",
  };
}

async function postWebhook(body: unknown, options: { signature?: string } = {}) {
  const raw = JSON.stringify(body);

  return fetch(`${apiUrl}/webhooks/kapso`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-signature": options.signature ?? hmacHex(secret, raw),
    },
    body: raw,
  });
}

function readItem(messageId: string) {
  return dynamo.send(
    new GetCommand({
      TableName: tableName,
      Key: { pk: PARTITION, sk: `RAW#${messageId}` },
      ConsistentRead: true,
    }),
  );
}

afterAll(async () => {
  await Promise.all([
    ...created.messageIds.map((messageId) =>
      dynamo.send(
        new DeleteCommand({ TableName: tableName, Key: { pk: PARTITION, sk: `RAW#${messageId}` } }),
      ),
    ),
    ...created.keys.map((Key) =>
      s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key })),
    ),
  ]);
});

describe("ingest against dev", () => {
  it(
    "answers the health check",
    async () => {
      const response = await fetch(`${apiUrl}/health`);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "ok", stage: "dev" });
    },
    TIMEOUT,
  );

  it(
    "rejects an unsigned delivery without writing anything",
    async () => {
      const messageId = newMessageId();

      const response = await postWebhook(payload(messageId), { signature: "not-a-signature" });

      expect(response.status).toBe(401);
      expect((await readItem(messageId)).Item).toBeUndefined();
    },
    TIMEOUT,
  );

  it(
    "stores a text message as a raw item",
    async () => {
      const messageId = newMessageId();

      const response = await postWebhook(payload(messageId));

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: "accepted", messageId });

      const { Item } = await readItem(messageId);

      expect(Item).toMatchObject({
        pk: PARTITION,
        sk: `RAW#${messageId}`,
        entityType: "InboundMessage",
        from: "+51999000001",
        fromIsE164: true,
        fromCountry: "PE",
        kind: "text",
        text: "integration probe",
      });
      expect(Item?.mediaKey).toBeUndefined();
      expect(Item?.payload).toBeDefined();
    },
    TIMEOUT,
  );

  it(
    "reports a redelivery as duplicate and keeps the first write",
    async () => {
      const messageId = newMessageId();

      await postWebhook(payload(messageId));
      const second = await postWebhook(
        payload(messageId, { text: { body: "tampered on redelivery" } }),
      );

      expect(await second.json()).toMatchObject({ duplicate: true });
      expect((await readItem(messageId)).Item?.text).toBe("integration probe");
    },
    TIMEOUT,
  );

  it(
    "downloads the media into S3 and links it from the item",
    async () => {
      const messageId = newMessageId();
      // The health endpoint is the only payload guaranteed to exist and stay small.
      const mediaUrl = `${apiUrl}/health`;

      const response = await postWebhook(
        payload(messageId, {
          type: "image",
          text: undefined,
          kapso: {
            has_media: true,
            media_url: mediaUrl,
            media_data: { url: mediaUrl, content_type: "application/json", byte_size: 30 },
            message_type_data: { caption: "with media" },
          },
        }),
      );

      expect(response.status).toBe(200);

      const { Item } = await readItem(messageId);
      const key = String(Item?.mediaKey);
      created.keys.push(key);

      expect(key).toBe(`inbound/${messageId}`);
      expect(Item?.text).toBe("with media");
      expect(Item?.mediaSizeBytes).toBeGreaterThan(0);

      const head = await s3.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));

      expect(head.ContentLength).toBe(Number(Item?.mediaSizeBytes));
    },
    TIMEOUT,
  );
});
