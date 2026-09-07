import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { JsonLogger, type LogFields } from "@watcher/core";
import { describe, expect, it } from "bun:test";
import { DynamoReminderRepository } from "../src/repositories/reminder.repository.js";

interface SentCommand {
  readonly input: Record<string, unknown>;
}

function build(options: { item?: Record<string, unknown>; fail?: boolean } = {}) {
  const sent: SentCommand[] = [];
  const lines: LogFields[] = [];
  const logger = new JsonLogger({ service: "notifier" }, (line) => {
    lines.push(JSON.parse(line) as LogFields);
  });

  const client = {
    async send(command: SentCommand) {
      sent.push(command);

      if (options.fail === true && command.input.ConditionExpression !== undefined) {
        throw new ConditionalCheckFailedException({ $metadata: {}, message: "no" });
      }

      return { Item: options.item };
    },
  } as unknown as DynamoDBDocumentClient;

  return { repository: new DynamoReminderRepository(client, "WatcherTable", logger), sent, lines };
}

describe("DynamoReminderRepository", () => {
  it("only calls a reminder pending while it says so", async () => {
    expect(await build({ item: { status: "PENDING" } }).repository.isPending("p", "s")).toBe(true);
    expect(await build({ item: { status: "SENT" } }).repository.isPending("p", "s")).toBe(false);
    expect(await build().repository.isPending("p", "s")).toBe(false);
  });

  it("reads it consistently, since the send depends on the answer", async () => {
    const { repository, sent } = build({ item: { status: "PENDING" } });

    await repository.isPending("p", "s");

    expect(sent[0]?.input.ConsistentRead).toBe(true);
  });

  it("takes the reminder out of the index in the same write that marks it sent", async () => {
    const { repository, sent } = build();

    await repository.markSent("USER#+51999000001", "ALARM#1#a");

    // AlarmDueIndex holds only what is still owed. A sent reminder left in it would be swept
    // back every five minutes for good, because expire() will not touch a non PENDING item.
    expect(sent[0]?.input.UpdateExpression).toBe(
      "SET #status = :sent, sentAtEpoch = :now REMOVE gsi1pk, gsi1sk",
    );
    expect(sent[0]?.input.ConditionExpression).toBe("#status = :pending");
  });

  it("treats an already marked reminder as done, not as a failure", async () => {
    const { repository, lines } = build({ fail: true });

    await repository.markSent("p", "s");

    expect(lines.some((line) => line.event === "reminder_already_marked")).toBe(true);
  });

  it("records an undeliverable reminder in its own terminal state, out of the index", async () => {
    const { repository, sent, lines } = build();

    await repository.markUndeliverable("p", "s", "outside_customer_service_window");

    // UNDELIVERABLE, not EXPIRED: one means nobody wanted it any more, the other means
    // somebody did and WhatsApp would not carry it.
    expect(sent[0]?.input.UpdateExpression).toContain(":undeliverable");
    expect(sent[0]?.input.UpdateExpression).toContain("REMOVE gsi1pk, gsi1sk");
    expect(sent[0]?.input.ExpressionAttributeValues).toMatchObject({
      ":undeliverable": "UNDELIVERABLE",
      ":reason": "outside_customer_service_window",
    });
    // Unconditional: whatever state it was in, it is not owed any more.
    expect(sent[0]?.input.ConditionExpression).toBeUndefined();
    expect(lines.some((line) => line.event === "reminder_undeliverable")).toBe(true);
  });
});
