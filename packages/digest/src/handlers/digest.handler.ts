import { describeError, runWithLogContext, type Logger } from "@watcher/core";
import { randomUUID } from "node:crypto";
import type { BuildDailyDigestService } from "../services/build-daily-digest.service.js";

export function makeDigestHandler(service: BuildDailyDigestService, logger: Logger) {
  return async () => {
    // Nothing upstream to inherit a trace from, so the run opens its own.
    return runWithLogContext({ correlationId: `digest-${randomUUID().slice(0, 8)}` }, async () => {
      try {
        return await service.execute();
      } catch (error) {
        logger.error("digest_failed", describeError(error));

        throw error;
      }
    });
  };
}
