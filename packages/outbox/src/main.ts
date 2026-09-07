import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { JsonLogger } from "@watcher/core";
import { loadOutboxConfig } from "./config.js";
import { makeStreamHandler } from "./handlers/stream.handler.js";
import { EventBridgeNoteEventPublisher } from "./repositories/note-event.publisher.js";
import { PublishNoteReceivedService } from "./services/publish-note-received.service.js";

const config = loadOutboxConfig();
const logger = new JsonLogger({ service: "outbox", stage: config.stage });

const publisher = new EventBridgeNoteEventPublisher(
  new EventBridgeClient({}),
  config.eventBusName,
  logger,
);

export const handler = makeStreamHandler(new PublishNoteReceivedService(publisher, logger), logger);
