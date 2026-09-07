import { ListSchedulesCommand, SchedulerClient } from "@aws-sdk/client-scheduler";
import { afterAll, describe, expect, it } from "bun:test";
import { Resource } from "sst";
import {
  cleanUp,
  hasEvent,
  itemsWithPrefix,
  newMessageId,
  sendWebhook,
  waitForItem,
  waitForLogs,
} from "./support/watcher.js";

const scheduler = new SchedulerClient({});
const created: string[] = [];

afterAll(async () => {
  await Promise.all(created.map((id) => cleanUp(id)));
});

/** Two minutes ahead, inside the 24 hour window, so no template is needed. */
function inTwoMinutes(): string {
  return new Date(Date.now() + 2 * 60_000).toLocaleTimeString("es-PE", {
    timeZone: "America/Lima",
    hour: "2-digit",
    minute: "2-digit",
  });
}

describe("reminder against dev", () => {
  it(
    "schedules the reminder the note asked for and fires it at its time",
    async () => {
      const id = newMessageId("reminder");
      created.push(id);

      await sendWebhook(id, { text: `recuérdame revisar el pipeline hoy a las ${inTwoMinutes()}` });

      const note = await waitForItem(`NOTE#${id}`);

      expect(Number(note?.dueAtEpoch)).toBeGreaterThan(0);

      const reminders = await itemsWithPrefix("ALARM#");
      const reminder = reminders.find((item) => item.messageId === id);

      expect(reminder).toMatchObject({ entityType: "Reminder", status: "PENDING", alarmId: id });

      const { Schedules } = await scheduler.send(
        new ListSchedulesCommand({ NamePrefix: `watcher-${id.replace(/[^A-Za-z0-9._-]/g, "_")}` }),
      );

      expect(Schedules ?? []).toHaveLength(1);

      // From here on it is EventBridge Scheduler's clock, not ours.
      const lines = await waitForLogs(
        Resource.NotifierFunction.name,
        id,
        (found) => found.some((line) => line.isReminder === true),
        300_000,
      );

      // The synthetic number is not on the allowlist, so the reminder arrives at the notifier
      // and is stopped there. That block is criterion 8, and it is what we can assert without
      // messaging a real phone: the scheduler fired and the fail-closed rule held.
      const reminderLine = lines.find((line) => line.isReminder === true);

      expect(reminderLine?.event).toBe("recipient_not_allowed");
      // The confirmation travelled the same queue to the same consumer.
      expect(lines.some((line) => line.isReminder === false)).toBe(true);

      const afterwards = await itemsWithPrefix("ALARM#");

      // Never sent, so never marked: a blocked reminder stays PENDING.
      expect(afterwards.find((item) => item.messageId === id)?.status).toBe("PENDING");
    },
    420_000,
  );

  it(
    "keeps the trace of the ingest across the scheduler",
    async () => {
      const id = newMessageId("trace");
      created.push(id);
      const correlationId = `itest-${Date.now()}`;

      await sendWebhook(id, { text: "comprar café", correlationId });

      const lines = await waitForLogs(Resource.NotifierFunction.name, correlationId, (found) =>
        hasEvent(found, "note_notified"),
      );

      expect(lines.every((line) => line.correlationId === correlationId)).toBe(true);
    },
    180_000,
  );
});
