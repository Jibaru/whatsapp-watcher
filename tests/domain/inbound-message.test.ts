import { describe, expect, it } from "bun:test";
import { InboundMessage } from "../../src/domain/inbound-message.js";

const baseProps = {
  messageId: "wamid-1",
  from: "+51999888777",
  kind: "text" as const,
  receivedAt: new Date("2026-09-06T10:00:00.000Z"),
};

describe("InboundMessage", () => {
  it("rechaza un messageId vacío", () => {
    expect(() => InboundMessage.create({ ...baseProps, messageId: "  " })).toThrow(/messageId/);
  });

  it("rechaza un remitente vacío", () => {
    expect(() => InboundMessage.create({ ...baseProps, from: "" })).toThrow(/from/);
  });

  it("sabe si trae media y calcula su clave en S3", () => {
    const withoutMedia = InboundMessage.create(baseProps);
    const withMedia = InboundMessage.create({
      ...baseProps,
      kind: "audio",
      media: { url: "https://kapso.example/media/1.ogg", mimeType: "audio/ogg" },
    });

    expect(withoutMedia.hasMedia()).toBe(false);
    expect(withoutMedia.mediaKey("dev")).toBeUndefined();
    expect(withMedia.hasMedia()).toBe(true);
    expect(withMedia.mediaKey("dev")).toBe("dev/wamid-1");
  });

  it("nunca expone el teléfono ni el texto en el registro de log", () => {
    const message = InboundMessage.create({ ...baseProps, text: "recuérdame llamar" });
    const record = message.toLogRecord();
    const serialized = JSON.stringify(record);

    expect(serialized).not.toContain("+51999888777");
    expect(serialized).not.toContain("recuérdame llamar");
    expect(record.fromHash).toMatch(/^[0-9a-f]{16}$/);
    expect(record.textLength).toBe(17);
  });
});
