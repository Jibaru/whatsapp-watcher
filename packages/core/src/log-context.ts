import { AsyncLocalStorage } from "node:async_hooks";

export interface LogContext {
  correlationId: string;
  conversationId?: string;
  messageId?: string;
}

const storage = new AsyncLocalStorage<LogContext>();

/**
 * Opened once per lambda invocation. Everything below it logs the same ids without
 * threading them through every signature, across await boundaries included.
 */
export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  return storage.run({ ...context }, fn);
}

/** Adds ids discovered mid-flight, such as the conversation once the payload is parsed. */
export function setLogContext(fields: Partial<LogContext>): void {
  const current = storage.getStore();

  if (current === undefined) {
    return;
  }

  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      Object.assign(current, { [key]: value });
    }
  }
}

export function getLogContext(): LogContext | undefined {
  return storage.getStore();
}
