import { describe, expect, it } from "bun:test";
import { DailyDigest, type DigestNote, type DigestReminder } from "../src/domain/daily-digest.js";

const from = new Date("2026-09-06T13:00:00.000Z");
const to = new Date("2026-09-07T13:00:00.000Z");

function note(overrides: Partial<DigestNote> = {}): DigestNote {
  return {
    noteId: "note-1",
    title: "Llamar al proveedor",
    summary: "Confirmar el pedido de cajas.",
    priority: "alta",
    createdAt: new Date("2026-09-06T21:14:00.000Z"),
    ...overrides,
  };
}

function reminder(overrides: Partial<DigestReminder> = {}): DigestReminder {
  return {
    alarmId: "wamid.1",
    title: "Llamar al proveedor",
    dueAt: new Date("2026-09-07T22:00:00.000Z"),
    ...overrides,
  };
}

function build(notes: DigestNote[] = [], reminders: DigestReminder[] = []) {
  return DailyDigest.create({
    stage: "dev",
    timeZone: "America/Lima",
    from,
    to,
    notes,
    reminders,
  });
}

describe("DailyDigest", () => {
  it("is empty when nothing was written and nothing is coming", () => {
    expect(build().isEmpty()).toBe(true);
    expect(build([note()]).isEmpty()).toBe(false);
    expect(build([], [reminder()]).isEmpty()).toBe(false);
  });

  it("refuses a window that ends before it starts", () => {
    expect(() =>
      DailyDigest.create({
        stage: "dev",
        timeZone: "America/Lima",
        from: to,
        to: from,
        notes: [],
        reminders: [],
      }),
    ).toThrow(/window/);
  });

  it("counts what it carries in the subject", () => {
    expect(build([note()], [reminder()]).subject()).toBe(
      "WhatsApp Watcher dev: 1 nota, 1 recordatorio",
    );
    expect(build([note(), note()]).subject()).toBe("WhatsApp Watcher dev: 2 notas");
  });

  it("keeps the subject to printable ASCII, which is all SNS accepts", () => {
    const subject = build([note({ title: "Café ⏰" })]).subject();

    expect(subject).toMatch(/^[\x20-\x7E]*$/);
    expect(subject.length).toBeLessThanOrEqual(100);
  });

  it("lists each note at its local time with its priority", () => {
    const body = build([note()]).body();

    // 21:14 UTC is 16:14 in Lima, and Lima is the day the note was filed under.
    expect(body).toContain("16:14 [alta] Llamar al proveedor");
    expect(body).toContain("Confirmar el pedido de cajas.");
  });

  it("marks the notes that left a reminder behind", () => {
    const body = build([note({ dueAt: new Date("2026-09-07T22:00:00.000Z") })]).body();

    expect(body).toContain("-> aviso 07/09 17:00");
  });

  it("does not repeat a summary that only echoes the title", () => {
    const body = build([note({ summary: "Llamar al proveedor" })]).body();

    expect(body.split("Llamar al proveedor")).toHaveLength(2);
  });

  it("lists what is due next, so the day starts with the agenda", () => {
    const body = build([], [reminder()]).body();

    expect(body).toContain("Recordatorios en las proximas 24 h: 1");
    expect(body).toContain("07/09 17:00  Llamar al proveedor");
  });
});
