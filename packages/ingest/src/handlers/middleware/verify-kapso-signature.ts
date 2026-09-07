import { hmacHex, safeCompare, type Logger } from "@watcher/core";
import { createMiddleware } from "hono/factory";
import type { IngestConfig } from "../../config.js";

const SIGNATURE_HEADER = "x-webhook-signature";

/**
 * KAPSO signs the raw body with HMAC-SHA256 (hex). Reading it through c.req.text() keeps the
 * exact bytes it signed: re-serializing the parsed JSON would change them and break the check.
 */
export function verifyKapsoSignature(config: IngestConfig, logger: Logger) {
  return createMiddleware(async (c, next) => {
    const signature = c.req.header(SIGNATURE_HEADER);
    const rawBody = await c.req.text();

    if (
      signature === undefined ||
      !safeCompare(signature, hmacHex(config.kapsoWebhookSecret, rawBody))
    ) {
      logger.warn("webhook_unauthorized", { signaturePresent: signature !== undefined });

      return c.json({ error: "unauthorized" }, 401);
    }

    await next();
  });
}
