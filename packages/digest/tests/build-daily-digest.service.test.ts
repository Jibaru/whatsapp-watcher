import { JsonLogger, NoopMetrics, type LogFields, type Metrics, type MetricUnit } from "@watcher/core";
import { describe, expect, it } from "bun:test";
import type { DigestNote, DigestReminder } from "../src/domain/daily-digest.js";
import type { DailyNoteRepository } from "../src/repositories/daily-note.repository.js";
import type { DigestPublisher } from "../src/repositories/digest.publisher.js";
import type { UpcomingReminderRepository } from "../src/repositories/upcoming-reminder.repository.js";
import { BuildDailyDigestService } from "../src/services/build-daily-digest.service.js";

const now = new Date("2026-09-07T13:00:00.000Z");

class FakeNotes implements DailyNoteRepository {
  window?: { from: Date; to: Date };

  constructor(private readonly found: DigestNote[] = []) {}

  async findCreatedBetween(from: Date, to: Date): Promise<DigestNote[]> {
    this.window = { from, to };

    return this.found;
  }
}

class FakeReminders implements UpcomingReminderRepository {
  window?: { from: Date; to: Date };

  constructor(private readonly found: DigestReminder[] = []) {}

  async findDueBetween(from: Date, to: Date): Promise<DigestReminder[]> {
    this.window = { from, to };

    return this.found;
  }
}

class FakePublisher implements DigestPublisher {
  readonly published: { subject: string; body: string }[] = [];
  error?: Error;

  async publish(subject: string, body: string): Promise<void> {
    if (this.error !== undefined) {
      throw this.error;
    }

    this.published.push({ subject, body });
  }
}

class RecordingMetrics implements Metrics {
  readonly counts: Record<string, number> = {};
  readonly values: { name: string; value: number; unit: MetricUnit }[] = [];

  count(name: string, value = 1): void {
    this.counts[name] = (this.counts[name] ?? 0) + value;
  }

  value(name: string, value: number, unit: MetricUnit): void {
    this.values.push({ name, value, unit });
  }
}

const note: DigestNote = {
  noteId: "note-1",
  title: "Llamar al proveedor",
  summary: "Confirmar el pedido.",
  priority: "alta",
  createdAt: new Date("2026-09-06T21:14:00.000Z"),
};

const reminder: DigestReminder = {
  alarmId: "wamid.1",
  title: "Llamar al proveedor",
  dueAt: new Date("2026-09-07T22:00:00.000Z"),
};

function build(found: { notes?: DigestNote[]; reminders?: DigestReminder[] } = {}) {
  const lines: LogFields[] = [];
  const logger = new JsonLogger({ service: "digest" }, (line) => {
    lines.push(JSON.parse(line) as LogFields);
  });
  const notes = new FakeNotes(found.notes ?? []);
  const reminders = new FakeReminders(found.reminders ?? []);
  const publisher = new FakePublisher();
  const metrics = new RecordingMetrics();
  const service = new BuildDailyDigestService(notes, reminders, publisher, logger, metrics, {
    stage: "dev",
    timeZone: "America/Lima",
    windowHours: 24,
    lookaheadHours: 24,
    now: () => now,
  });

  return { service, notes, reminders, publisher, metrics, lines };
}

describe("BuildDailyDigestService", () => {
  it("looks back 24 hours and ahead another 24", async () => {
    const { service, notes, reminders } = build({ notes: [note] });

    await service.execute();

    expect(notes.window?.from.toISOString()).toBe("2026-09-06T13:00:00.000Z");
    expect(notes.window?.to.toISOString()).toBe(now.toISOString());
    expect(reminders.window?.from.toISOString()).toBe(now.toISOString());
    expect(reminders.window?.to.toISOString()).toBe("2026-09-08T13:00:00.000Z");
  });

  it("sends the summary when there is something to say", async () => {
    const { service, publisher } = build({ notes: [note], reminders: [reminder] });

    expect(await service.execute()).toEqual({ notes: 1, reminders: 1, sent: true });
    expect(publisher.published[0]?.subject).toContain("1 nota");
    expect(publisher.published[0]?.body).toContain("Llamar al proveedor");
  });

  it("sends nothing on a day with no notes and no reminders", async () => {
    const { service, publisher, lines } = build();

    expect(await service.execute()).toEqual({ notes: 0, reminders: 0, sent: false });
    expect(publisher.published).toHaveLength(0);
    expect(lines.some((line) => line.event === "digest_empty")).toBe(true);
  });

  it("still counts the run on a quiet day, which is what proves the cron is alive", async () => {
    const { service, metrics } = build();

    await service.execute();

    expect(metrics.counts.digest_runs).toBe(1);
    expect(metrics.counts.digest_sent).toBeUndefined();
    expect(metrics.values).toEqual([{ name: "digest_notes", value: 0, unit: "Count" }]);
  });

  it("counts the email only once it actually went out", async () => {
    const { service, metrics } = build({ notes: [note] });

    await service.execute();

    expect(metrics.counts.digest_runs).toBe(1);
    expect(metrics.counts.digest_sent).toBe(1);
  });

  it("propagates a publish failure, so the alarm on the lambda can see it", async () => {
    const { service, publisher } = build({ notes: [note] });
    publisher.error = new Error("SNS is down");

    await expect(service.execute()).rejects.toThrow("SNS is down");
  });

  it("summarises a day whose only content is what is coming", async () => {
    const { service, publisher } = build({ reminders: [reminder] });

    expect(await service.execute()).toEqual({ notes: 0, reminders: 1, sent: true });
    expect(publisher.published).toHaveLength(1);
  });
});

// Kept so the shared NoopMetrics stays wired into at least one construction path.
describe("BuildDailyDigestService with the default metrics sink", () => {
  it("runs without a recording sink", async () => {
    const service = new BuildDailyDigestService(
      new FakeNotes([note]),
      new FakeReminders(),
      new FakePublisher(),
      new JsonLogger({ service: "digest" }, () => undefined),
      new NoopMetrics(),
      {
        stage: "dev",
        timeZone: "America/Lima",
        windowHours: 24,
        lookaheadHours: 24,
        now: () => now,
      },
    );

    expect((await service.execute()).sent).toBe(true);
  });
});
