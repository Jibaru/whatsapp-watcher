import { JsonLogger } from "@watcher/core";
import { handle } from "hono/aws-lambda";
import { createApp } from "./app.js";
import { loadIngestConfig } from "./config.js";
import { LoggingInboundMessageRepository } from "./repositories/logging-inbound-message.repository.js";
import { ReceiveInboundMessageService } from "./services/receive-inbound-message.service.js";

// Composition root: a missing secret throws here, on the cold start, not mid-request.
const config = loadIngestConfig();
const logger = new JsonLogger({ service: "ingest", stage: config.stage });

const repository = new LoggingInboundMessageRepository(logger);
const receiveInboundMessage = new ReceiveInboundMessageService(repository, logger, {
  logRawPayload: !config.isProduction,
});

const app = createApp({ config, logger, receiveInboundMessage });

export const handler = handle(app);
