import { afterAll, describe, expect, it } from "bun:test";
import { Resource } from "sst";
import {
  cleanUp,
  hasEvent,
  newMessageId,
  readItem,
  sendWebhook,
  waitForItem,
  waitForLogs,
} from "./support/watcher.js";

const created: string[] = [];

function messageId(prefix: string): string {
  const id = newMessageId(prefix);
  created.push(id);

  return id;
}

afterAll(async () => {
  await Promise.all(created.map((id) => cleanUp(id)));
});

describe("processor against dev", () => {
  it(
    "turns a message into a structured note with its reminder",
    async () => {
      const id = messageId("note");

      const response = await sendWebhook(id, {
        text: "recuérdame llamar al proveedor mañana a las 10 de la mañana, es urgente",
      });

      expect(response.status).toBe(200);

      const note = await waitForItem(`NOTE#${id}`);

      expect(note).toBeDefined();
      expect(note).toMatchObject({ entityType: "Note", status: "OPEN", priority: "high" });
      expect(String(note?.title).length).toBeGreaterThan(0);
      expect(Array.isArray(note?.tags)).toBe(true);
      // The model was told the instant and the timezone, so it must resolve "mañana a las 10".
      expect(Number(note?.dueAtEpoch)).toBeGreaterThan(Math.floor(Date.now() / 1000));
    },
    180_000,
  );

  it(
    "marks a message it can never process as FAILED, and does not retry it",
    async () => {
      // Neither text nor media: there is nothing to analyze, and that never changes on a retry.
      const id = messageId("fail");

      await sendWebhook(id);

      const raw = await waitForItem(`RAW#${id}`, (item) => item.status === "FAILED");

      expect(raw).toMatchObject({ status: "FAILED", failureCode: "no_analyzable_content" });
      expect(await readItem(`NOTE#${id}`)).toBeUndefined();

      const lines = await waitForLogs(Resource.ProcessorFunction.name, id, (found) =>
        hasEvent(found, "note_failed_published"),
      );

      expect(hasEvent(lines, "note_failed_published")).toBe(true);
      expect(lines.filter((line) => line.event === "note_processing_started")).toHaveLength(1);
      expect(lines.find((line) => line.event === "note_processing_failed")?.retryable).toBe(false);
    },
    180_000,
  );
});
