import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { afterAll, describe, expect, it } from "bun:test";
import { Resource } from "sst";
import { cleanUp, dynamo, itemsWithPrefix, readItem, TEST_PARTITION } from "./support/watcher.js";

const lambda = new LambdaClient({});
const planted: string[] = [];

afterAll(async () => {
  await cleanUp("none");
});

/**
 * Plants a reminder the scheduler never knew about, which is exactly the state the sweep
 * exists for: a schedule that was never created, or one whose delivery was lost.
 */
async function plantReminder(alarmId: string, dueSecondsAgo: number) {
  const dueAtEpoch = Math.floor(Date.now() / 1000) - dueSecondsAgo;
  const sk = `ALARM#${dueAtEpoch}#${alarmId}`;
  planted.push(sk);

  await dynamo.send(
    new PutCommand({
      TableName: Resource.WatcherTable.name,
      Item: {
        pk: TEST_PARTITION,
        sk,
        entityType: "Reminder",
        alarmId,
        noteId: `note-${alarmId}`,
        messageId: `wamid.${alarmId}`,
        title: "Recordatorio huérfano",
        status: "PENDING",
        dueAtEpoch,
        gsi1pk: "ALARM#PENDING",
        gsi1sk: dueAtEpoch,
      },
    }),
  );

  return sk;
}

async function runSweep() {
  const response = await lambda.send(
    new InvokeCommand({
      FunctionName: Resource.EvaluatorFunction.name,
      Payload: new TextEncoder().encode("{}"),
    }),
  );

  return JSON.parse(new TextDecoder().decode(response.Payload)) as {
    swept: number;
    expired: number;
  };
}

describe("evaluator against dev", () => {
  it(
    "rescues a reminder the scheduler never delivered and expires the ancient ones",
    async () => {
      const late = await plantReminder(`sweep-${Date.now()}`, 600);
      const ancient = await plantReminder(`old-${Date.now()}`, 90_000);

      const result = await runSweep();

      expect(result.swept).toBeGreaterThanOrEqual(1);
      expect(result.expired).toBeGreaterThanOrEqual(1);

      // Too old to be worth ringing, and it leaves the index so it stops coming back.
      const expired = await readItem(ancient);

      expect(expired?.status).toBe("EXPIRED");
      expect(expired?.gsi1pk).toBeUndefined();

      // The rescued one went to the queue; the notifier decides what happens to it.
      expect((await readItem(late))?.status).toBe("PENDING");
    },
    120_000,
  );

  it(
    "leaves a reminder alone while it is inside the grace window",
    async () => {
      const fresh = await plantReminder(`fresh-${Date.now()}`, 30);

      const result = await runSweep();
      const stillPending = await readItem(fresh);

      expect(stillPending?.status).toBe("PENDING");
      expect(stillPending?.gsi1pk).toBe("ALARM#PENDING");
      expect(result.expired).toBe(0);
    },
    120_000,
  );

  it(
    "finds nothing to do once the table is quiet",
    async () => {
      for (const sk of await itemsWithPrefix("ALARM#")) {
        await dynamo.send(
          new PutCommand({
            TableName: Resource.WatcherTable.name,
            Item: { ...sk, status: "SENT", gsi1pk: undefined, gsi1sk: undefined },
          }),
        ).catch(() => undefined);
      }

      expect(await runSweep()).toEqual({ swept: 0, expired: 0 });
    },
    120_000,
  );
});
