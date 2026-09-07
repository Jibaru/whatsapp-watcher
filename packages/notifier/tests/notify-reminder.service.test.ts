import {
  ALARM_DUE,
  JsonLogger,
  NoopMetrics,
  type DispatchEnvelope,
  type LogFields,
  type ReminderDueDetail,
} from "@watcher/core";
import type { ReminderRepository } from "../src/repositories/reminder.repository.js";
import { describe, expect, it } from "bun:test";
import type { OutboundMessage, WhatsAppSender } from "../src/repositories/whatsapp.sender.js";
import { NotifyReminderService } from "../src/services/notify-reminder.service.js";

class FakeReminders implements ReminderRepository {
  readonly marked: string[] = [];

  constructor(private readonly pending = true) {}

  async isPending(): Promise<boolean> {
    return this.pending;
  }

  async markSent(pk: string, sk: string): Promise<void> {
    this.marked.push(`${pk}|${sk}`);
  }
}

class FakeSender implements WhatsAppSender {
  readonly sent: OutboundMessage[] = [];
  error?: Error;

  async send(message: OutboundMessage): Promise<void> {
    if (this.error !== undefined) {
      throw this.error;
    }

    this.sent.push(message);
  }
}

const detail: ReminderDueDetail = {
  correlationId: "corr-1",
  messageId: "wamid.1",
  noteId: "note-1",
  alarmId: "wamid.1",
  pk: "USER#+51999000001",
  sk: "ALARM#1788800000#wamid.1",
  to: "+51999000001",
  owner: "+51999000001",
  title: "Llamar al proveedor",
  dueAt: "2026-09-08T15:00:00.000Z",
};

const reminder: DispatchEnvelope = {
  source: "watcher.scheduler",
  "detail-type": ALARM_DUE,
  detail,
};

function build(
  options: { isProduction?: boolean; allowedRecipients?: string[]; pending?: boolean } = {},
) {
  const lines: LogFields[] = [];
  const logger = new JsonLogger({ service: "notifier" }, (line) => {
    lines.push(JSON.parse(line) as LogFields);
  });
  const sender = new FakeSender();
  const reminders = new FakeReminders(options.pending ?? true);
  const service = new NotifyReminderService(sender, reminders, logger, new NoopMetrics(), {
    isProduction: options.isProduction ?? false,
    allowedRecipients: options.allowedRecipients ?? [],
  });

  return { service, sender, reminders, lines };
}

describe("NotifyReminderService", () => {
  it("sends the reminder to a number on the allowlist and marks it sent", async () => {
    const { service, sender, reminders } = build({ allowedRecipients: ["+51999000001"] });

    const output = await service.execute({ envelope: reminder });

    expect(output).toEqual({ sent: true });
    expect(sender.sent[0]?.to).toBe("+51999000001");
    expect(sender.sent[0]?.body).toContain("Llamar al proveedor");
    expect(reminders.marked).toEqual(["USER#+51999000001|ALARM#1788800000#wamid.1"]);
  });

  it("also matches the delivery address, for a number that could not be normalized", async () => {
    const { service, sender } = build({ allowedRecipients: ["999000001"] });

    const output = await service.execute({
      envelope: { ...reminder, detail: { ...detail, to: "999000001", owner: "999000001" } },
    });

    expect(output.sent).toBe(true);
    expect(sender.sent[0]?.to).toBe("999000001");
  });

  it("does not send to a number that is not on the allowlist", async () => {
    const { service, sender } = build({ allowedRecipients: ["+51900000000"] });

    const output = await service.execute({ envelope: reminder });

    expect(output.sent).toBe(false);
    expect(sender.sent).toHaveLength(0);
  });

  it("sends nothing outside production when the allowlist is empty", async () => {
    const { service, sender, lines } = build({ allowedRecipients: [] });

    const output = await service.execute({ envelope: reminder });

    expect(output).toEqual({ sent: false, reason: "recipient_not_allowed" });
    expect(sender.sent).toHaveLength(0);
    expect(lines.some((line) => line.event === "recipient_not_allowed")).toBe(true);
  });

  it("does not filter recipients in production", async () => {
    const { service, sender } = build({ isProduction: true, allowedRecipients: [] });

    await service.execute({ envelope: reminder });

    expect(sender.sent).toHaveLength(1);
  });

  it("does not ring twice when the queue redelivers a reminder", async () => {
    const { service, sender } = build({ allowedRecipients: ["+51999000001"], pending: false });

    const output = await service.execute({ envelope: reminder });

    expect(output).toEqual({ sent: false, reason: "already_sent" });
    expect(sender.sent).toHaveLength(0);
  });

  it("leaves the reminder pending when the send fails", async () => {
    const { service, sender, reminders } = build({ allowedRecipients: ["+51999000001"] });
    sender.error = new Error("KAPSO is down");

    await expect(service.execute({ envelope: reminder })).rejects.toThrow("KAPSO is down");
    // Marking it before the send would turn a retryable failure into a silent broken promise.
    expect(reminders.marked).toHaveLength(0);
  });
});
