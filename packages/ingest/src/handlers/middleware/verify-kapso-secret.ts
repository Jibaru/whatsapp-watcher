import { safeCompare, type Logger } from "@watcher/core";
import { createMiddleware } from "hono/factory";
import type { IngestConfig } from "../../config.js";

/** Registered before the routes so the secret is checked before Zod parses the body. */
export function verifyKapsoSecret(config: IngestConfig, logger: Logger) {
  return createMiddleware(async (c, next) => {
    const provided = c.req.header(config.kapsoSecretHeader);

    if (provided === undefined || !safeCompare(provided, config.kapsoWebhookSecret)) {
      logger.warn("webhook_unauthorized", {
        header: config.kapsoSecretHeader,
        headerPresent: provided !== undefined,
      });

      return c.json({ error: "unauthorized" }, 401);
    }

    await next();
  });
}
