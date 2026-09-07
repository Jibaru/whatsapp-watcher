import { randomUUID } from "node:crypto";
import {
  describeError,
  getLogContext,
  isRetryable,
  type Logger,
  type Metrics,
  type NoteReceivedDetail,
} from "@watcher/core";
import { NoAnalyzableContentError, UnsupportedMediaError } from "../domain/errors.js";
import { Note } from "../domain/note.js";
import type { InboundMessageReader, SourceMessage } from "../repositories/inbound-message.reader.js";
import type { MediaReader } from "../repositories/media.reader.js";
import type { NoteAnalyzer } from "../repositories/note-analyzer.js";
import type { NoteEventPublisher } from "../repositories/note-event.publisher.js";
import type { FailedMessageRepository } from "../repositories/failed-message.repository.js";
import type { NoteRepository } from "../repositories/note.repository.js";
import type { ReminderRepository } from "../repositories/reminder.repository.js";
import type { ReminderScheduler } from "../repositories/reminder.scheduler.js";

export interface ProcessNoteInput {
  readonly note: NoteReceivedDetail;
  readonly receiveCount: number;
}

export interface ProcessNoteOutput {
  readonly noteId: string;
  readonly hasReminder: boolean;
}

export interface ProcessNoteOptions {
  readonly defaultTimezone: string;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

const ANALYZABLE_KINDS = new Set(["text", "image", "audio", "unknown"]);

export class ProcessNoteService {
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(
    private readonly messages: InboundMessageReader,
    private readonly media: MediaReader,
    private readonly analyzer: NoteAnalyzer,
    private readonly notes: NoteRepository,
    private readonly publisher: NoteEventPublisher,
    private readonly failures: FailedMessageRepository,
    private readonly reminders: ReminderRepository,
    private readonly scheduler: ReminderScheduler,
    private readonly logger: Logger,
    private readonly metrics: Metrics,
    private readonly options: ProcessNoteOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? randomUUID;
  }

  async execute(input: ProcessNoteInput): Promise<ProcessNoteOutput> {
    try {
      return await this.process(input);
    } catch (error) {
      // A permanent error is acknowledged and never retried, so unless the note is marked here
      // it disappears with nothing but a log line and no alarm can see it.
      if (!isRetryable(error)) {
        await this.recordFailure(input.note, error);
      }

      throw error;
    }
  }

  private async recordFailure(note: NoteReceivedDetail, error: unknown): Promise<void> {
    const described = describeError(error);
    const code = String(described.code ?? described.name ?? "unknown");

    this.metrics.count("notes_dropped");
    await this.failures.markFailed(note.pk, note.sk, code, String(described.message ?? ""));
    await this.publisher.publishNoteFailed({
      messageId: note.messageId,
      pk: note.pk,
      sk: note.sk,
      owner: note.from,
      code,
      reason: String(described.message ?? ""),
    });
  }

  private async process(input: ProcessNoteInput): Promise<ProcessNoteOutput> {
    this.logger.info("note_processing_started", {
      kind: input.note.kind,
      hasMedia: input.note.hasMedia,
      receiveCount: input.receiveCount,
    });

    const source = await this.messages.read(input.note.pk, input.note.sk);

    if (!ANALYZABLE_KINDS.has(source.kind)) {
      throw new UnsupportedMediaError(source.kind);
    }

    const media = await this.loadMedia(source);

    if (media === undefined && (source.text === undefined || source.text.trim() === "")) {
      throw new NoAnalyzableContentError();
    }

    const analyzed = await this.analyzer.analyze({
      text: source.text,
      image: source.kind === "image" ? media : undefined,
      audio: source.kind === "audio" ? media : undefined,
      now: this.now(),
      timezone: this.options.defaultTimezone,
    });

    const note = Note.create({
      noteId: this.newId(),
      messageId: source.messageId,
      owner: source.from,
      title: analyzed.title,
      summary: analyzed.summary,
      tags: analyzed.tags,
      priority: analyzed.priority,
      confidence: analyzed.confidence,
      createdAt: this.now(),
      dueAt: parseDueAt(analyzed.dueAt),
      mediaKey: source.mediaKey,
    });

    await this.notes.save(note);

    if (note.hasReminder()) {
      await this.scheduleReminder(note, source.fromAddress, input.note);
    }

    await this.publisher.publishNoteProcessed({
      messageId: note.messageId,
      noteId: note.noteId,
      pk: input.note.pk,
      sk: input.note.sk,
      // Always the full international number. A national one lets the provider guess the
      // country, and a wrong guess delivers the note to a stranger.
      to: source.from.startsWith("+") ? source.from : source.fromAddress,
      owner: note.owner,
      title: note.title,
      summary: note.summary,
      priority: note.priority,
      dueAt: note.dueAt?.toISOString(),
    });

    this.metrics.count("notes_processed");
    this.metrics.value("model_confidence", note.confidence, "None");

    this.logger.info("note_processed", {
      ...note.toLogRecord(),
      transcribed: analyzed.transcript !== undefined,
    });

    return { noteId: note.noteId, hasReminder: note.hasReminder() };
  }

  /**
   * Written before it is scheduled: a schedule that fires with no reminder to read would
   * ring for something that does not exist.
   */
  private async scheduleReminder(
    note: Note,
    address: string,
    received: NoteReceivedDetail,
  ): Promise<void> {
    const reminder = await this.reminders.save(note);
    const context = getLogContext();

    await this.scheduler.schedule(
      {
        correlationId: context?.correlationId ?? note.messageId,
        conversationId: context?.conversationId,
        messageId: note.messageId,
        noteId: note.noteId,
        alarmId: reminder.alarmId,
        pk: reminder.pk,
        sk: reminder.sk,
        to: received.from.startsWith("+") ? received.from : address,
        owner: note.owner,
        title: note.title,
        dueAt: reminder.dueAt.toISOString(),
      },
      reminder.dueAt,
    );
  }

  private async loadMedia(source: SourceMessage) {
    if (source.mediaKey === undefined) {
      return undefined;
    }

    const stored = await this.media.read(source.mediaKey, source.mediaMimeType);

    return { bytes: stored.bytes, mimeType: stored.contentType };
  }
}

/** A model can answer a date that Date cannot parse; that is not worth failing the note. */
function parseDueAt(value: string | undefined): Date | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
