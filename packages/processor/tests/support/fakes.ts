import { JsonLogger, type LogFields, type Logger } from "@watcher/core";
import type { Note } from "../../src/domain/note.js";
import type {
  InboundMessageReader,
  SourceMessage,
} from "../../src/repositories/inbound-message.reader.js";
import type { MediaReader, StoredMedia } from "../../src/repositories/media.reader.js";
import type {
  AnalyzedNote,
  AnalyzeNoteCommand,
  NoteAnalyzer,
} from "../../src/repositories/note-analyzer.js";
import type {
  NoteEventPublisher,
  PublishNoteProcessedCommand,
} from "../../src/repositories/note-event.publisher.js";
import type { NoteRepository } from "../../src/repositories/note.repository.js";

export function memoryLogger() {
  const lines: LogFields[] = [];
  const logger: Logger = new JsonLogger({ service: "processor" }, (line) => {
    lines.push(JSON.parse(line) as LogFields);
  });

  return { logger, lines, events: () => lines.map((line) => String(line.event)) };
}

export const sourceMessage: SourceMessage = {
  messageId: "wamid.1",
  from: "+51999000001",
  fromAddress: "999000001",
  kind: "text",
  text: "recuérdame llamar al proveedor mañana a las 10",
};

export class FakeMessageReader implements InboundMessageReader {
  constructor(private readonly result: SourceMessage | Error = sourceMessage) {}

  async read(): Promise<SourceMessage> {
    if (this.result instanceof Error) {
      throw this.result;
    }

    return this.result;
  }
}

export class FakeMediaReader implements MediaReader {
  readonly reads: string[] = [];

  async read(key: string): Promise<StoredMedia> {
    this.reads.push(key);

    return { bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" };
  }
}

export class FakeAnalyzer implements NoteAnalyzer {
  readonly calls: AnalyzeNoteCommand[] = [];

  constructor(private readonly result: AnalyzedNote | Error = defaultAnalysis) {}

  async analyze(command: AnalyzeNoteCommand): Promise<AnalyzedNote> {
    this.calls.push(command);

    if (this.result instanceof Error) {
      throw this.result;
    }

    return this.result;
  }
}

export const defaultAnalysis: AnalyzedNote = {
  title: "Llamar al proveedor",
  summary: "Recordatorio para llamar al proveedor.",
  tags: ["trabajo"],
  priority: "normal",
  confidence: 0.9,
  dueAt: "2026-09-08T15:00:00.000Z",
};

export class FakeNoteRepository implements NoteRepository {
  readonly saved: Note[] = [];

  async save(note: Note): Promise<void> {
    this.saved.push(note);
  }
}

export class FakeNotePublisher implements NoteEventPublisher {
  readonly published: PublishNoteProcessedCommand[] = [];

  async publishNoteProcessed(command: PublishNoteProcessedCommand): Promise<void> {
    this.published.push(command);
  }
}
