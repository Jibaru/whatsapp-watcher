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
        (found) => hasEvent(found, "recipient_not_allowed"),
        300_000,
      );

      // The synthetic number is not on the allowlist, so the reminder arrives at the notifier
      // and is stopped there. That block is criterion 8, and it is what we can assert without
      // messaging a real phone: the scheduler fired and the fail-closed rule held.
      const blocked = lines.find((line) => line.event === "recipient_not_allowed");

      expect(blocked?.alarmId).toBe(id);

      // The reminder is the only thing the notifier ever saw about this note: capturing it
      // produced no message of its own.
      expect(lines.filter((line) => line.alarmId === id)).toHaveLength(1);

      const afterwards = await itemsWithPrefix("ALARM#");

      // Never sent, so never marked: a blocked reminder stays PENDING.
      expect(afterwards.find((item) => item.messageId === id)?.status).toBe("PENDING");
    },
    420_000,
  );

  it(
    "stays silent for a note with no hour, and keeps the trace all the way to the processor",
    async () => {
      const id = newMessageId("silent");
      created.push(id);
      const correlationId = `itest-${Date.now()}`;

      await sendWebhook(id, { text: "comprar café", correlationId });

      const lines = await waitForLogs(Resource.ProcessorFunction.name, correlationId, (found) =>
        hasEvent(found, "note_processed"),
      );

      expect(hasEvent(lines, "note_processed")).toBe(true);
      expect(lines.every((line) => line.correlationId === correlationId)).toBe(true);

      const note = await waitForItem(`NOTE#${id}`);

      expect(note?.dueAtEpoch).toBeUndefined();

      // No reminder means nothing to notify: no schedule, and nothing on the way to WhatsApp.
      const reminders = await itemsWithPrefix("ALARM#");

      expect(reminders.find((item) => item.messageId === id)).toBeUndefined();
    },
    180_000,
  );
});
