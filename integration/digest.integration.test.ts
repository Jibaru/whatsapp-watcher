import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { DeleteCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { noteDayPartition } from "@watcher/core";
import { afterAll, describe, expect, it } from "bun:test";
import { Resource } from "sst";
import { dynamo, TEST_PARTITION } from "./support/watcher.js";

const lambda = new LambdaClient({});
const planted: string[] = [];

const TIME_ZONE = "America/Lima";
const HOUR = 60 * 60 * 1000;

afterAll(async () => {
  await Promise.all(
    planted.map((sk) =>
      dynamo.send(
        new DeleteCommand({
          TableName: Resource.WatcherTable.name,
          Key: { pk: TEST_PARTITION, sk },
        }),
      ),
    ),
  );
});

async function plantNote(suffix: string, createdAt: Date, dueAt?: Date) {
  const sk = `NOTE#digest-${suffix}-${Date.now()}`;
  planted.push(sk);

  await dynamo.send(
    new PutCommand({
      TableName: Resource.WatcherTable.name,
      Item: {
        pk: TEST_PARTITION,
        sk,
        entityType: "Note",
        noteId: sk,
        messageId: sk,
        title: `Nota de prueba ${suffix}`,
        summary: "Plantada por el test de integración.",
        priority: "normal",
        confidence: 0.9,
        status: "OPEN",
        createdAtEpoch: Math.floor(createdAt.getTime() / 1000),
        dueAtEpoch: dueAt === undefined ? undefined : Math.floor(dueAt.getTime() / 1000),
        gsi2pk: noteDayPartition(createdAt, TIME_ZONE),
        gsi2sk: Math.floor(createdAt.getTime() / 1000),
      },
    }),
  );

  return sk;
}

async function plantReminder(suffix: string, dueAt: Date) {
  const dueAtEpoch = Math.floor(dueAt.getTime() / 1000);
  const sk = `ALARM#${dueAtEpoch}#digest-${suffix}-${Date.now()}`;
  planted.push(sk);

  await dynamo.send(
    new PutCommand({
      TableName: Resource.WatcherTable.name,
      Item: {
        pk: TEST_PARTITION,
        sk,
        entityType: "Reminder",
        alarmId: sk,
        noteId: sk,
        messageId: sk,
        title: `Recordatorio de prueba ${suffix}`,
        status: "PENDING",
        dueAtEpoch,
        gsi1pk: "ALARM#PENDING",
        gsi1sk: dueAtEpoch,
      },
    }),
  );

  return sk;
}

async function runDigest() {
  const response = await lambda.send(
    new InvokeCommand({
      FunctionName: Resource.DigestFunction.name,
      Payload: new TextEncoder().encode("{}"),
    }),
  );

  return JSON.parse(new TextDecoder().decode(response.Payload)) as {
    notes: number;
    reminders: number;
    sent: boolean;
  };
}

describe("digest against dev", () => {
  it(
    "counts only what falls inside the window, in a table it shares with everything else",
    async () => {
      // The dev table is not ours alone, so the assertion is on the delta, not the total.
      const before = await runDigest();

      await plantNote("reciente", new Date(Date.now() - 2 * HOUR));
      await plantNote("antigua", new Date(Date.now() - 72 * HOUR));
      await plantReminder("proximo", new Date(Date.now() + 2 * HOUR));
      await plantReminder("lejano", new Date(Date.now() + 96 * HOUR));

      const after = await runDigest();

      expect(after.notes).toBe(before.notes + 1);
      expect(after.reminders).toBe(before.reminders + 1);
    },
    180_000,
  );

  it(
    "sends the email once there is something to say",
    async () => {
      await plantNote("enviable", new Date(Date.now() - 1 * HOUR));

      const result = await runDigest();

      expect(result.sent).toBe(true);
      expect(result.notes).toBeGreaterThanOrEqual(1);
    },
    180_000,
  );

  it(
    "reads yesterday's partition as well as today's",
    async () => {
      // Written under the previous local day, so a digest that only queried today would lose
      // it. Which partitions a window touches is covered by the unit tests for dayKeysBetween;
      // this proves the repository really asks for both.
      const yesterday = new Date(Date.now() - 20 * HOUR);
      const before = await runDigest();

      await plantNote("ayer", yesterday);

      const after = await runDigest();

      expect(after.notes).toBe(before.notes + 1);
      expect(noteDayPartition(yesterday, TIME_ZONE)).not.toBe(
        noteDayPartition(new Date(), TIME_ZONE),
      );
    },
    180_000,
  );
});
