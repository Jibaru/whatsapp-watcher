import { handle } from "hono/aws-lambda";
import { createApp } from "./app.js";
import { loadAppConfig } from "./config/env.js";
import { JsonLogger } from "./lib/logger.js";
import { LoggingInboundMessageRepository } from "./repositories/logging-inbound-message.repository.js";
import { ReceiveInboundMessageService } from "./services/receive-inbound-message.service.js";

// Composition root. Si falta configuración, revienta aquí y la Lambda no llega a servir.
const config = loadAppConfig();
const logger = new JsonLogger({ service: "ingest", stage: config.stage });

const repository = new LoggingInboundMessageRepository(logger);
const receiveInboundMessage = new ReceiveInboundMessageService(repository, logger, {
  logRawPayload: !config.isProduction,
});

const app = createApp({ config, logger, receiveInboundMessage });

export const handler = handle(app);
