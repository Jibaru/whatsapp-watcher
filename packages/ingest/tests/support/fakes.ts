import { JsonLogger, type LogFields, type Logger } from "@watcher/core";
import type { InboundMessage } from "../../src/domain/inbound-message.js";
import {
  MediaTooLargeError,
  type InboundMediaRepository,
  type StoreMediaCommand,
  type StoredMedia,
} from "../../src/repositories/inbound-media.repository.js";
import type {
  InboundMessageRepository,
  SaveOutcome,
} from "../../src/repositories/inbound-message.repository.js";
import type {
  NoteEventPublisher,
  PublishNoteReceivedCommand,
} from "../../src/repositories/note-event.publisher.js";

/** Wraps the real logger so the assertions see exactly what CloudWatch would get. */
export class MemoryLogger implements Logger {
  readonly entries: LogFields[] = [];
  private readonly delegate: Logger;

  constructor() {
    this.delegate = new JsonLogger({}, (line) => {
      this.entries.push(JSON.parse(line) as LogFields);
    });
  }

  child(fields: LogFields): Logger {
    return this.delegate.child(fields);
  }

  info(event: string, fields: LogFields = {}): void {
    this.delegate.info(event, fields);
  }

  warn(event: string, fields: LogFields = {}): void {
    this.delegate.warn(event, fields);
  }

  error(event: string, fields: LogFields = {}): void {
    this.delegate.error(event, fields);
  }

  events(): string[] {
    return this.entries.map((entry) => String(entry.event));
  }

  find(event: string): LogFields | undefined {
    return this.entries.find((entry) => entry.event === event);
  }
}

/** Shared between both fakes so a test can assert that the media lands before the write. */
export class CallLog {
  readonly calls: string[] = [];
}

export class FakeInboundMessageRepository implements InboundMessageRepository {
  readonly saved: InboundMessage[] = [];

  constructor(
    private readonly outcome: Pick<SaveOutcome, "stored" | "duplicate"> = {
      stored: true,
      duplicate: false,
    },
    private readonly callLog = new CallLog(),
  ) {}

  async save(message: InboundMessage): Promise<SaveOutcome> {
    this.callLog.calls.push("save");
    this.saved.push(message);

    return {
      ...this.outcome,
      pk: `USER#${message.from}`,
      sk: `RAW#${message.messageId}`,
    };
  }
}

export class FakeNoteEventPublisher implements NoteEventPublisher {
  readonly published: PublishNoteReceivedCommand[] = [];

  constructor(
    private readonly behaviour: { fails?: boolean } = {},
    private readonly callLog = new CallLog(),
  ) {}

  async publishNoteReceived(command: PublishNoteReceivedCommand): Promise<void> {
    this.callLog.calls.push("publish");
    this.published.push(command);

    if (this.behaviour.fails === true) {
      throw new Error("PutEvents rejected the entry");
    }
  }
}

export class FakeInboundMediaRepository implements InboundMediaRepository {
  readonly stored: StoreMediaCommand[] = [];

  constructor(
    private readonly behaviour: { tooLarge?: boolean; fails?: boolean } = {},
    private readonly callLog = new CallLog(),
  ) {}

  async store(command: StoreMediaCommand): Promise<StoredMedia> {
    this.callLog.calls.push("store");
    this.stored.push(command);

    if (this.behaviour.tooLarge === true) {
      throw new MediaTooLargeError(99_000_000, 16_777_216);
    }

    if (this.behaviour.fails === true) {
      throw new Error("download failed");
    }

    return {
      key: `inbound/${command.messageId}.jpg`,
      sizeBytes: command.declaredSizeBytes ?? 1024,
      contentType: command.contentType ?? "image/jpeg",
    };
  }
}
