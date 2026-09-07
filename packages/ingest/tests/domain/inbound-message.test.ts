import { describe, expect, it } from "bun:test";
import { InboundMessage } from "../../src/domain/inbound-message.js";

const baseProps = {
  messageId: "wamid-1",
  from: "+51999888777",
  kind: "text" as const,
  receivedAt: new Date("2026-09-06T10:00:00.000Z"),
};

describe("InboundMessage", () => {
  it("rejects an empty messageId", () => {
    expect(() => InboundMessage.create({ ...baseProps, messageId: "  " })).toThrow(/messageId/);
  });

  it("rejects an empty sender", () => {
    expect(() => InboundMessage.create({ ...baseProps, from: "" })).toThrow(/from/);
  });

  it("knows whether it carries media", () => {
    const withoutMedia = InboundMessage.create(baseProps);
    const withMedia = InboundMessage.create({
      ...baseProps,
      kind: "audio",
      media: { url: "https://kapso.example/media/1.ogg", mimeType: "audio/ogg" },
    });

    expect(withoutMedia.hasMedia()).toBe(false);
    expect(withMedia.hasMedia()).toBe(true);
    expect(withMedia.media?.mimeType).toBe("audio/ogg");
  });

  it("never exposes the phone number or the text in its log record", () => {
    const message = InboundMessage.create({ ...baseProps, text: "recuerdame llamar" });
    const record = message.toLogRecord();
    const serialized = JSON.stringify(record);

    expect(serialized).not.toContain("+51999888777");
    expect(serialized).not.toContain("recuerdame llamar");
    expect(record.fromHash).toMatch(/^[0-9a-f]{16}$/);
    expect(record.textLength).toBe(17);
  });
});
