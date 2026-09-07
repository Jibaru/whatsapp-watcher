import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppConfig } from "./config/env.js";
import { healthRoute, makeHealthHandler } from "./handlers/health.handler.js";
import { kapsoWebhookRoute, makeKapsoWebhookHandler } from "./handlers/kapso-webhook.handler.js";
import { verifyKapsoSecret } from "./handlers/middleware/verify-kapso-secret.js";
import type { Logger } from "./lib/logger.js";
import type { ReceiveInboundMessageService } from "./services/receive-inbound-message.service.js";

export interface AppDependencies {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly receiveInboundMessage: ReceiveInboundMessageService;
}

export function createApp(deps: AppDependencies) {
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        deps.logger.warn("webhook_invalid_payload", { issues: result.error.issues });

        return c.json({ error: "invalid_payload" }, 400);
      }

      return undefined;
    },
  });

  // Antes de las rutas: el secreto se comprueba antes de parsear el body.
  app.use("/webhooks/*", verifyKapsoSecret(deps.config, deps.logger));

  app.openapi(healthRoute, makeHealthHandler(deps.config.stage));
  app.openapi(kapsoWebhookRoute, makeKapsoWebhookHandler(deps.receiveInboundMessage));

  return app;
}
