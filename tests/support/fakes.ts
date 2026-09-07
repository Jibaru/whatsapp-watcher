import type { InboundMessage } from "../../src/domain/inbound-message.js";
import type { LogFields, Logger } from "../../src/lib/logger.js";
import type {
  InboundMessageRepository,
  SaveOutcome,
} from "../../src/repositories/inbound-message.repository.js";

export interface LogEntry {
  readonly level: string;
  readonly event: string;
  readonly fields: LogFields;
}

export class MemoryLogger implements Logger {
  readonly entries: LogEntry[] = [];

  child(): Logger {
    return this;
  }

  info(event: string, fields: LogFields = {}): void {
    this.entries.push({ level: "info", event, fields });
  }

  warn(event: string, fields: LogFields = {}): void {
    this.entries.push({ level: "warn", event, fields });
  }

  error(event: string, fields: LogFields = {}): void {
    this.entries.push({ level: "error", event, fields });
  }

  events(): string[] {
    return this.entries.map((entry) => entry.event);
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
