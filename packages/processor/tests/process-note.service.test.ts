import { NoopMetrics, type NoteReceivedDetail } from "@watcher/core";
import { describe, expect, it } from "bun:test";
import { ModelUnavailableError, SourceMessageNotFoundError } from "../src/domain/errors.js";
import { ProcessNoteService } from "../src/services/process-note.service.js";
import {
  FakeAnalyzer,
  FakeMediaReader,
  FakeMessageReader,
  FakeNotePublisher,
  FakeFailedMessages,
  FakeNoteRepository,
  FakeReminderRepository,
  FakeReminderScheduler,
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
  options: { source?: SourceMessage | Error; analysis?: AnalyzedNote | Error } = {},
) {
  const { logger, events } = memoryLogger();
  const media = new FakeMediaReader();
  const analyzer = new FakeAnalyzer(options.analysis);
  const notes = new FakeNoteRepository();
  const publisher = new FakeNotePublisher();
  const failures = new FakeFailedMessages();
  const reminders = new FakeReminderRepository();
  const scheduler = new FakeReminderScheduler();
  const service = new ProcessNoteService(
    new FakeMessageReader(options.source),
    media,
    analyzer,
    notes,
    publisher,
    failures,
    reminders,
    scheduler,
    logger,
    new NoopMetrics(),
    {
      defaultTimezone: "America/Lima",
      now: () => now,
      newId: () => "note-1",
    },
  );

  return { service, media, analyzer, notes, publisher, failures, reminders, scheduler, events };
}

describe("ProcessNoteService", () => {
  it("turns a message into a stored note", async () => {
    const { service, notes } = build();

    const output = await service.execute({ note: detail, receiveCount: 1 });

    expect(output).toEqual({ noteId: "note-1", hasReminder: true });
    expect(notes.saved[0]?.title).toBe("Llamar al proveedor");
    expect(notes.saved[0]?.owner).toBe("+51999000001");
    expect(notes.saved[0]?.dueAt?.toISOString()).toBe("2026-09-08T15:00:00.000Z");
  });

  it("says nothing back: a stored note is silence, only the reminder speaks", async () => {
    const { service, publisher, scheduler } = build({
      analysis: { title: "Nota", summary: "", tags: [], priority: "normal", confidence: 0.9 },
    });

    await service.execute({ note: detail, receiveCount: 1 });

    expect(publisher.failures).toHaveLength(0);
    expect(scheduler.scheduled).toHaveLength(0);
  });

  it("always writes to the full international number", async () => {
    const { service, scheduler } = build();

    await service.execute({ note: detail, receiveCount: 1 });

    expect(scheduler.scheduled[0]?.detail.to).toBe("+51999000001");
    expect(scheduler.scheduled[0]?.detail.owner).toBe("+51999000001");
  });

  it("falls back to the provider address only when the number could not be normalized", async () => {
    const { service, scheduler } = build({
      source: { ...sourceMessage, from: "999000001", fromAddress: "999000001" },
    });

    await service.execute({ note: detail, receiveCount: 1 });

    expect(scheduler.scheduled[0]?.detail.to).toBe("999000001");
  });

  it("writes the reminder and schedules it when the note has a due date", async () => {
    const { service, reminders, scheduler } = build();

    await service.execute({ note: detail, receiveCount: 1 });

    expect(reminders.saved).toHaveLength(1);
    expect(scheduler.scheduled[0]?.dueAt.toISOString()).toBe("2026-09-08T15:00:00.000Z");
    expect(scheduler.scheduled[0]?.detail).toMatchObject({
      alarmId: "wamid.1",
      sk: "ALARM#1788800000#wamid.1",
      to: "+51999000001",
      title: "Llamar al proveedor",
    });
  });

  it("schedules nothing for a note without a due date", async () => {
    const { service, reminders, scheduler } = build({
      analysis: { title: "Nota", summary: "", tags: [], priority: "normal", confidence: 0.9 },
    });

    await service.execute({ note: detail, receiveCount: 1 });

    expect(reminders.saved).toHaveLength(0);
    expect(scheduler.scheduled).toHaveLength(0);
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

  it("transcribes a voice note and analyzes the transcript", async () => {
    const { service, media, analyzer, notes } = build({
      source: { ...sourceMessage, kind: "audio", mediaKey: "inbound/wamid.1.ogg", text: undefined },
    });

    await service.execute({ note: { ...detail, kind: "audio", hasMedia: true }, receiveCount: 1 });

    expect(media.reads).toEqual(["inbound/wamid.1.ogg"]);
    expect(analyzer.calls[0]?.audio?.mimeType).toBe("image/jpeg");
    expect(analyzer.calls[0]?.image).toBeUndefined();
    expect(notes.saved).toHaveLength(1);
  });

  it("refuses a message with neither text nor media", async () => {
    const { service } = build({
      source: { ...sourceMessage, kind: "text", text: undefined, mediaKey: undefined },
    });

    const error = await service.execute({ note: detail, receiveCount: 1 }).catch((e) => e);

    expect(error.code).toBe("no_analyzable_content");
    expect(error.retryable).toBe(false);
  });

  it("propagates a missing source as permanent, so it is not retried", async () => {
    const { service } = build({ source: new SourceMessageNotFoundError("USER#x", "RAW#y") });

    const error = await service.execute({ note: detail, receiveCount: 1 }).catch((e) => e);

    expect(error).toBeInstanceOf(SourceMessageNotFoundError);
    expect(error.retryable).toBe(false);
  });

  it("marks the message FAILED and announces the drop when the error is permanent", async () => {
    const { service, failures, publisher } = build({ source: { ...sourceMessage, kind: "video" } });

    await service.execute({ note: detail, receiveCount: 1 }).catch(() => undefined);

    expect(failures.marked).toEqual([
      { pk: "USER#+51999000001", sk: "RAW#wamid.1", code: "unsupported_media" },
    ]);
    expect(publisher.failures[0]).toMatchObject({
      messageId: "wamid.1",
      code: "unsupported_media",
      owner: "+51999000001",
    });
  });

  it("leaves a retryable failure alone, since the queue will bring it back", async () => {
    const { service, failures, publisher } = build({
      analysis: new ModelUnavailableError(new Error("throttled")),
    });

    await service.execute({ note: detail, receiveCount: 1 }).catch(() => undefined);

    expect(failures.marked).toHaveLength(0);
    expect(publisher.failures).toHaveLength(0);
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

  it("does not schedule a reminder for a note it could not store", async () => {
    const { service, scheduler, notes } = build();
    notes.save = async () => {
      throw new Error("dynamo is down");
    };

    await expect(service.execute({ note: detail, receiveCount: 1 })).rejects.toThrow(/dynamo/);
    // A schedule that fires for a note nobody wrote would ring for something that does not exist.
    expect(scheduler.scheduled).toHaveLength(0);
  });
});
