import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { JsonLogger, type LogFields } from "@watcher/core";
import { describe, expect, it } from "bun:test";
import { DynamoDueReminderRepository } from "../src/repositories/due-reminder.repository.js";

interface SentCommand {
  readonly input: Record<string, unknown>;
}

function build(options: { fail?: boolean } = {}) {
  const sent: SentCommand[] = [];
  const lines: LogFields[] = [];
  const logger = new JsonLogger({ service: "evaluator" }, (line) => {
    lines.push(JSON.parse(line) as LogFields);
  });

  const client = {
    async send(command: SentCommand) {
      sent.push(command);

      if (options.fail === true && command.input.ConditionExpression !== undefined) {
        throw new ConditionalCheckFailedException({ $metadata: {}, message: "no" });
      }

      return { Items: [] };
    },
  } as unknown as DynamoDBDocumentClient;

  return {
    repository: new DynamoDueReminderRepository(client, "WatcherTable", logger),
    sent,
    lines,
  };
}

describe("DynamoDueReminderRepository", () => {
  it("asks the index for what is due, never the table", async () => {
    const { repository, sent } = build();

    await repository.findPendingBefore(1788800000, 25);

    expect(sent[0]?.input.IndexName).toBe("AlarmDueIndex");
    expect(sent[0]?.input.KeyConditionExpression).toBe("gsi1pk = :pending AND gsi1sk <= :epoch");
  });

  it("expires a pending reminder and takes it out of the index", async () => {
    const { repository, sent } = build();

    await repository.expire("p", "s");

    expect(sent[0]?.input.UpdateExpression).toContain("REMOVE gsi1pk, gsi1sk");
    expect(sent[0]?.input.ConditionExpression).toBe("#status = :pending");
  });

  it("still unindexes a reminder that left PENDING behind its back", async () => {
    const { repository, sent, lines } = build({ fail: true });

    await repository.expire("p", "s");

    // Without this second write the item stays in the index and comes back every sweep, since
    // the conditional update can never succeed again.
    expect(sent[1]?.input.UpdateExpression).toBe("REMOVE gsi1pk, gsi1sk");
    expect(sent[1]?.input.ConditionExpression).toBeUndefined();
    expect(lines.some((line) => line.event === "reminder_no_longer_pending")).toBe(true);
  });
});
