import type { Logger } from "@watcher/core";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { IngestConfig } from "./config.js";
import { healthRoute, makeHealthHandler } from "./handlers/health.handler.js";
import { kapsoWebhookRoute, makeKapsoWebhookHandler } from "./handlers/kapso-webhook.handler.js";
import { withLogContext } from "./handlers/middleware/log-context.js";
import { verifyKapsoSignature } from "./handlers/middleware/verify-kapso-signature.js";
import type { ReceiveInboundMessageService } from "./services/receive-inbound-message.service.js";

export interface AppDependencies {
  readonly config: IngestConfig;
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

  app.use(withLogContext());
  app.use("/webhooks/*", verifyKapsoSignature(deps.config, deps.logger));

  app.onError((error, c) => {
    deps.logger.error("request_failed", { message: error.message, name: error.name });

    return c.json({ error: "internal_error" }, 500);
  });

  app.openapi(healthRoute, makeHealthHandler(deps.config.stage));
  app.openapi(kapsoWebhookRoute, makeKapsoWebhookHandler(deps.receiveInboundMessage));

  return app;
}
