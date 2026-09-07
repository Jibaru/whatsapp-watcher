import { randomUUID } from "node:crypto";
import type { Logger, NoteReceivedDetail } from "@watcher/core";
import { UnsupportedMediaError } from "../domain/errors.js";
import { Note } from "../domain/note.js";
import type { InboundMessageReader, SourceMessage } from "../repositories/inbound-message.reader.js";
import type { MediaReader } from "../repositories/media.reader.js";
import type { NoteAnalyzer } from "../repositories/note-analyzer.js";
import type { NoteEventPublisher } from "../repositories/note-event.publisher.js";
import type { NoteRepository } from "../repositories/note.repository.js";

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

const ANALYZABLE_KINDS = new Set(["text", "image", "unknown"]);

export class ProcessNoteService {
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(
    private readonly messages: InboundMessageReader,
    private readonly media: MediaReader,
    private readonly analyzer: NoteAnalyzer,
    private readonly notes: NoteRepository,
    private readonly publisher: NoteEventPublisher,
    private readonly logger: Logger,
    private readonly options: ProcessNoteOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? randomUUID;
  }

  async execute(input: ProcessNoteInput): Promise<ProcessNoteOutput> {
    this.logger.info("note_processing_started", {
      kind: input.note.kind,
      hasMedia: input.note.hasMedia,
      receiveCount: input.receiveCount,
    });

    const source = await this.messages.read(input.note.pk, input.note.sk);

    if (!ANALYZABLE_KINDS.has(source.kind)) {
      throw new UnsupportedMediaError(source.kind);
    }

    const analyzed = await this.analyzer.analyze({
      text: source.text,
      image: await this.loadImage(source),
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
    await this.publisher.publishNoteProcessed({
      messageId: note.messageId,
      noteId: note.noteId,
      pk: input.note.pk,
      sk: input.note.sk,
      to: note.owner,
      title: note.title,
      summary: note.summary,
      priority: note.priority,
      dueAt: note.dueAt?.toISOString(),
    });

    this.logger.info("note_processed", note.toLogRecord());

    return { noteId: note.noteId, hasReminder: note.hasReminder() };
  }

  private async loadImage(source: SourceMessage) {
    if (source.mediaKey === undefined || source.kind !== "image") {
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
