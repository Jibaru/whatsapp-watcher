import { describeError, runWithLogContext, type Logger } from "@watcher/core";
import { randomUUID } from "node:crypto";
import type { SweepRemindersService } from "../services/sweep-reminders.service.js";

export function makeSweepHandler(service: SweepRemindersService, logger: Logger) {
  return async () => {
    // Nothing upstream to inherit a trace from, so the sweep opens its own.
    return runWithLogContext({ correlationId: `sweep-${randomUUID().slice(0, 8)}` }, async () => {
      try {
        return await service.execute();
      } catch (error) {
        logger.error("reminder_sweep_failed", describeError(error));

        throw error;
      }
    });
  };
}
