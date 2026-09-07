import { JsonLogger, type LogFields, type NoteProcessedDetail } from "@watcher/core";
import { describe, expect, it } from "bun:test";
import type { OutboundMessage, WhatsAppSender } from "../src/repositories/whatsapp.sender.js";
import { NotifyNoteService } from "../src/services/notify-note.service.js";

class FakeSender implements WhatsAppSender {
  readonly sent: OutboundMessage[] = [];

  async send(message: OutboundMessage): Promise<void> {
    this.sent.push(message);
  }
}

const note: NoteProcessedDetail = {
  correlationId: "corr-1",
  messageId: "wamid.1",
  noteId: "note-1",
  pk: "USER#+51999000001",
  sk: "RAW#wamid.1",
  to: "+51999000001",
  owner: "+51999000001",
  title: "Llamar al proveedor",
  summary: "Recordatorio para llamar al proveedor.",
  priority: "normal",
  dueAt: "2026-09-08T15:00:00.000Z",
};

function build(options: { isProduction?: boolean; allowedRecipients?: string[] } = {}) {
  const lines: LogFields[] = [];
  const logger = new JsonLogger({ service: "notifier" }, (line) => {
    lines.push(JSON.parse(line) as LogFields);
  });
  const sender = new FakeSender();
  const service = new NotifyNoteService(sender, logger, {
    isProduction: options.isProduction ?? false,
    allowedRecipients: options.allowedRecipients ?? [],
  });

  return { service, sender, lines };
}

describe("NotifyNoteService", () => {
  it("sends to a number on the allowlist", async () => {
    const { service, sender } = build({ allowedRecipients: ["+51999000001"] });

    const output = await service.execute({ note });

    expect(output).toEqual({ sent: true });
    expect(sender.sent[0]?.to).toBe("+51999000001");
    expect(sender.sent[0]?.body).toContain("Llamar al proveedor");
  });

  it("also matches the delivery address, for a number that could not be normalized", async () => {
    const { service, sender } = build({ allowedRecipients: ["999000001"] });

    const output = await service.execute({
      note: { ...note, to: "999000001", owner: "999000001" },
    });

    expect(output.sent).toBe(true);
    expect(sender.sent[0]?.to).toBe("999000001");
  });

  it("does not send to a number that is not on the allowlist", async () => {
    const { service, sender } = build({ allowedRecipients: ["+51900000000"] });

    const output = await service.execute({ note });

    expect(output.sent).toBe(false);
    expect(sender.sent).toHaveLength(0);
  });

  it("sends nothing outside production when the allowlist is empty", async () => {
    const { service, sender, lines } = build({ allowedRecipients: [] });

    const output = await service.execute({ note });

    expect(output).toEqual({ sent: false, reason: "recipient_not_allowed" });
    expect(sender.sent).toHaveLength(0);
    expect(lines.some((line) => line.event === "recipient_not_allowed")).toBe(true);
  });

  it("does not filter recipients in production", async () => {
    const { service, sender } = build({ isProduction: true, allowedRecipients: [] });

    await service.execute({ note });

    expect(sender.sent).toHaveLength(1);
  });

  it("mentions the reminder only when the note has one", async () => {
    const { service, sender } = build({ allowedRecipients: ["+51999000001"] });

    await service.execute({ note });
    await service.execute({ note: { ...note, dueAt: undefined } });

    expect(sender.sent[0]?.body).toContain("Te aviso");
    expect(sender.sent[1]?.body).not.toContain("Te aviso");
  });
});
