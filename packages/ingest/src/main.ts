import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { JsonLogger } from "@watcher/core";
import { handle } from "hono/aws-lambda";
import { createApp } from "./app.js";
import { loadIngestConfig } from "./config.js";
import { DynamoInboundMessageRepository } from "./repositories/dynamo-inbound-message.repository.js";
import { EventBridgeNoteEventPublisher } from "./repositories/note-event.publisher.js";
import { S3InboundMediaRepository } from "./repositories/s3-inbound-media.repository.js";
import { ReceiveInboundMessageService } from "./services/receive-inbound-message.service.js";

// Composition root: a missing secret throws here, on the cold start, not mid-request.
const config = loadIngestConfig();
const logger = new JsonLogger({ service: "ingest", stage: config.stage });

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  // Optional attributes are the norm here (no text, no media, no country).
  marshallOptions: { removeUndefinedValues: true },
});

const messageRepository = new DynamoInboundMessageRepository(
  documentClient,
  config.tableName,
  logger,
);
const mediaRepository = new S3InboundMediaRepository(
  new S3Client({}),
  config.mediaBucket,
  config.mediaMaxBytes,
  logger,
);

const publisher = new EventBridgeNoteEventPublisher(
  new EventBridgeClient({}),
  config.eventBusName,
  logger,
);

const receiveInboundMessage = new ReceiveInboundMessageService(
  messageRepository,
  mediaRepository,
  publisher,
  logger,
  { logRawPayload: !config.isProduction },
);

const app = createApp({ config, logger, receiveInboundMessage });

export const handler = handle(app);
