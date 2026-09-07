import { JsonLogger, NoopMetrics, type LogFields, type ReminderDueDetail } from "@watcher/core";
import { describe, expect, it } from "bun:test";
import type { DispatchQueue } from "../src/repositories/dispatch.queue.js";
import type {
  DueReminder,
  DueReminderRepository,
} from "../src/repositories/due-reminder.repository.js";
import { SweepRemindersService } from "../src/services/sweep-reminders.service.js";

const now = new Date("2026-09-07T18:00:00.000Z");
const nowEpoch = Math.floor(now.getTime() / 1000);

function reminder(overrides: Partial<DueReminder> = {}): DueReminder {
  return {
    pk: "USER#+51999000001",
    sk: "ALARM#1788800000#wamid.1",
    alarmId: "wamid.1",
    noteId: "note-1",
    messageId: "wamid.1",
    owner: "+51999000001",
    title: "Llamar al proveedor",
    dueAtEpoch: nowEpoch - 300,
    ...overrides,
  };
}

class FakeReminders implements DueReminderRepository {
  readonly expired: string[] = [];
  queriedBefore?: number;

  constructor(private readonly found: DueReminder[] = []) {}

  async findPendingBefore(epoch: number): Promise<DueReminder[]> {
    this.queriedBefore = epoch;

    return this.found;
  }

  async expire(pk: string, sk: string): Promise<void> {
    this.expired.push(`${pk}|${sk}`);
  }
}

class FakeQueue implements DispatchQueue {
  readonly enqueued: ReminderDueDetail[] = [];

  async enqueue(detail: ReminderDueDetail): Promise<void> {
    this.enqueued.push(detail);
  }
}

function build(found: DueReminder[] = []) {
  const lines: LogFields[] = [];
  const logger = new JsonLogger({ service: "evaluator" }, (line) => {
    lines.push(JSON.parse(line) as LogFields);
  });
  const reminders = new FakeReminders(found);
  const queue = new FakeQueue();
  const service = new SweepRemindersService(reminders, queue, logger, new NoopMetrics(), {
    graceSeconds: 120,
    giveUpSeconds: 3600,
    now: () => now,
  });

  return { service, reminders, queue, lines };
}

describe("SweepRemindersService", () => {
  it("does nothing when no reminder is late", async () => {
    const { service, queue, lines } = build([]);

    expect(await service.execute()).toEqual({ swept: 0, expired: 0 });
    expect(queue.enqueued).toHaveLength(0);
    expect(lines).toHaveLength(0);
  });

  it("leaves the scheduler its grace window before touching anything", async () => {
    const { service, reminders } = build([]);

    await service.execute();

    expect(reminders.queriedBefore).toBe(nowEpoch - 120);
  });

  it("re-enqueues a reminder the scheduler never delivered", async () => {
    const { service, queue } = build([reminder()]);

    expect(await service.execute()).toEqual({ swept: 1, expired: 0 });
    expect(queue.enqueued[0]).toMatchObject({
      alarmId: "wamid.1",
      to: "+51999000001",
      owner: "+51999000001",
      title: "Llamar al proveedor",
      sk: "ALARM#1788800000#wamid.1",
    });
  });

  it("keeps the trace of the note that created the reminder", async () => {
    const { service, queue } = build([reminder({ correlationId: "corr-from-ingest" })]);

    await service.execute();

    expect(queue.enqueued[0]?.correlationId).toBe("corr-from-ingest");
  });

  it("expires a reminder too old to be worth ringing", async () => {
    const { service, queue, reminders } = build([reminder({ dueAtEpoch: nowEpoch - 7200 })]);

    expect(await service.execute()).toEqual({ swept: 0, expired: 1 });
    expect(queue.enqueued).toHaveLength(0);
    expect(reminders.expired).toEqual(["USER#+51999000001|ALARM#1788800000#wamid.1"]);
  });

  it("handles a batch with both kinds", async () => {
    const { service, queue, reminders } = build([
      reminder({ alarmId: "recent", dueAtEpoch: nowEpoch - 300 }),
      reminder({ alarmId: "ancient", sk: "ALARM#1#ancient", dueAtEpoch: nowEpoch - 90_000 }),
    ]);

    expect(await service.execute()).toEqual({ swept: 1, expired: 1 });
    expect(queue.enqueued[0]?.alarmId).toBe("recent");
    expect(reminders.expired).toEqual(["USER#+51999000001|ALARM#1#ancient"]);
  });

  it("says so in the log only when it actually found work", async () => {
    const quiet = build([]);
    const busy = build([reminder()]);

    await quiet.service.execute();
    await busy.service.execute();

    expect(quiet.lines.some((line) => line.event === "reminder_sweep_found_work")).toBe(false);
    expect(busy.lines.some((line) => line.event === "reminder_sweep_found_work")).toBe(true);
  });
});
