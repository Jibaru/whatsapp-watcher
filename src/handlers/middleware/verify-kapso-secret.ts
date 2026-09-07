import { createMiddleware } from "hono/factory";
import type { AppConfig } from "../../config/env.js";
import { safeCompare } from "../../lib/hash.js";
import type { Logger } from "../../lib/logger.js";

/**
 * Verifica el secreto compartido ANTES de que Zod toque el body (§6.1 del enunciado).
 * Fail-closed: sin cabecera o con secreto distinto, 401 y nada se procesa.
 */
export function verifyKapsoSecret(config: AppConfig, logger: Logger) {
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
