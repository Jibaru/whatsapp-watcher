export type LogFields = Record<string, unknown>;

export interface Logger {
  child(fields: LogFields): Logger;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export class JsonLogger implements Logger {
  constructor(private readonly base: LogFields = {}) {}

  child(fields: LogFields): Logger {
    return new JsonLogger({ ...this.base, ...fields });
  }

  info(event: string, fields: LogFields = {}): void {
    this.write("info", event, fields);
  }

  warn(event: string, fields: LogFields = {}): void {
    this.write("warn", event, fields);
  }

  error(event: string, fields: LogFields = {}): void {
    this.write("error", event, fields);
  }

  private write(level: string, event: string, fields: LogFields): void {
    console.log(
      JSON.stringify({
        level,
        event,
        timestamp: new Date().toISOString(),
        ...this.base,
        ...fields,
      }),
    );
  }
}
