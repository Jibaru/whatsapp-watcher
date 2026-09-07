import type { NoteReceivedDetail } from "@watcher/core";
import { describe, expect, it } from "bun:test";
import {
  ModelUnavailableError,
  SourceMessageNotFoundError,
  UnsupportedMediaError,
} from "../src/domain/errors.js";
import { ProcessNoteService } from "../src/services/process-note.service.js";
import {
  FakeAnalyzer,
  FakeMediaReader,
  FakeMessageReader,
  FakeNotePublisher,
  FakeNoteRepository,
  memoryLogger,
  sourceMessage,
} from "./support/fakes.js";
import type { AnalyzedNote } from "../src/repositories/note-analyzer.js";
import type { SourceMessage } from "../src/repositories/inbound-message.reader.js";

const now = new Date("2026-09-07T12:00:00.000Z");

const detail: NoteReceivedDetail = {
  correlationId: "corr-1",
  conversationId: "conv-1",
  messageId: "wamid.1",
  pk: "USER#+51999000001",
  sk: "RAW#wamid.1",
  from: "+51999000001",
  kind: "text",
  hasMedia: false,
  receivedAt: now.toISOString(),
};

function build(
  options: { source?: SourceMessage | Error; analysis?: AnalyzedNote | Error; vision?: boolean } = {},
) {
  const { logger, events } = memoryLogger();
  const media = new FakeMediaReader();
  const analyzer = new FakeAnalyzer(options.analysis);
  const notes = new FakeNoteRepository();
  const publisher = new FakeNotePublisher();
  const service = new ProcessNoteService(
    new FakeMessageReader(options.source),
    media,
    analyzer,
    notes,
    publisher,
    logger,
    {
      defaultTimezone: "America/Lima",
      modelSupportsImages: options.vision ?? true,
      now: () => now,
      newId: () => "note-1",
    },
  );

  return { service, media, analyzer, notes, publisher, events };
}

describe("ProcessNoteService", () => {
  it("turns a message into a stored note and announces it", async () => {
    const { service, notes, publisher } = build();

    const output = await service.execute({ note: detail, receiveCount: 1 });

    expect(output).toEqual({ noteId: "note-1", hasReminder: true });
    expect(notes.saved[0]?.title).toBe("Llamar al proveedor");
    expect(notes.saved[0]?.owner).toBe("+51999000001");
    expect(notes.saved[0]?.dueAt?.toISOString()).toBe("2026-09-08T15:00:00.000Z");
    expect(publisher.published[0]).toMatchObject({
      noteId: "note-1",
      to: "+51999000001",
      title: "Llamar al proveedor",
      dueAt: "2026-09-08T15:00:00.000Z",
    });
  });

  it("gives the model the current instant and the timezone to resolve relative dates", async () => {
    const { service, analyzer } = build();

    await service.execute({ note: detail, receiveCount: 1 });

    expect(analyzer.calls[0]).toMatchObject({ now, timezone: "America/Lima" });
    expect(analyzer.calls[0]?.text).toBe(sourceMessage.text);
  });

  it("reads the image from S3 and hands it to the model", async () => {
    const { service, media, analyzer } = build({
      source: { ...sourceMessage, kind: "image", mediaKey: "inbound/wamid.1.jpg", text: "buenas" },
    });

    await service.execute({ note: { ...detail, kind: "image", hasMedia: true }, receiveCount: 1 });

    expect(media.reads).toEqual(["inbound/wamid.1.jpg"]);
    expect(analyzer.calls[0]?.image?.mimeType).toBe("image/jpeg");
  });

  it("falls back to the caption when the model cannot see images", async () => {
    const { service, media, analyzer, notes } = build({
      vision: false,
      source: { ...sourceMessage, kind: "image", mediaKey: "inbound/wamid.1.jpg", text: "buenas" },
    });

    await service.execute({ note: { ...detail, kind: "image", hasMedia: true }, receiveCount: 1 });

    expect(media.reads).toHaveLength(0);
    expect(analyzer.calls[0]?.image).toBeUndefined();
    expect(analyzer.calls[0]?.text).toBe("buenas");
    expect(notes.saved).toHaveLength(1);
  });

  it("refuses an image with no caption when the model cannot see", async () => {
    const { service } = build({
      vision: false,
      source: { ...sourceMessage, kind: "image", mediaKey: "inbound/wamid.1.jpg", text: undefined },
    });

    const error = await service.execute({ note: detail, receiveCount: 1 }).catch((e) => e);

    expect(error.code).toBe("no_analyzable_content");
    expect(error.retryable).toBe(false);
  });

  it("refuses audio permanently: no Claude model on Bedrock accepts it yet", async () => {
    const { service, notes } = build({ source: { ...sourceMessage, kind: "audio" } });

    await expect(service.execute({ note: detail, receiveCount: 1 })).rejects.toBeInstanceOf(
      UnsupportedMediaError,
    );
    expect(notes.saved).toHaveLength(0);
  });

  it("propagates a missing source as permanent, so it is not retried", async () => {
    const { service } = build({ source: new SourceMessageNotFoundError("USER#x", "RAW#y") });

    const error = await service.execute({ note: detail, receiveCount: 1 }).catch((e) => e);

    expect(error).toBeInstanceOf(SourceMessageNotFoundError);
    expect(error.retryable).toBe(false);
  });

  it("propagates a model outage as retryable", async () => {
    const { service } = build({ analysis: new ModelUnavailableError(new Error("throttled")) });

    const error = await service.execute({ note: detail, receiveCount: 1 }).catch((e) => e);

    expect(error.retryable).toBe(true);
  });

  it("ignores a due date the model could not express", async () => {
    const { service, notes } = build({
      analysis: {
        title: "Nota",
        summary: "",
        tags: [],
        priority: "normal",
        confidence: 0.5,
        dueAt: "mañana",
      },
    });

    const output = await service.execute({ note: detail, receiveCount: 1 });

    expect(output.hasReminder).toBe(false);
    expect(notes.saved[0]?.dueAt).toBeUndefined();
  });

  it("does not announce a note it could not store", async () => {
    const { service, publisher, notes } = build();
    notes.save = async () => {
      throw new Error("dynamo is down");
    };

    await expect(service.execute({ note: detail, receiveCount: 1 })).rejects.toThrow(/dynamo/);
    expect(publisher.published).toHaveLength(0);
  });
});
