import { JsonLogger, type LogFields, type Logger } from "@watcher/core";
import type { InboundMessage } from "../../src/domain/inbound-message.js";
import type {
  InboundMessageRepository,
  SaveOutcome,
} from "../../src/repositories/inbound-message.repository.js";

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

export class FakeInboundMessageRepository implements InboundMessageRepository {
  readonly saved: InboundMessage[] = [];

  constructor(private readonly outcome: SaveOutcome = { stored: true, duplicate: false }) {}

  async save(message: InboundMessage): Promise<SaveOutcome> {
    this.saved.push(message);

    return this.outcome;
  }
}
