import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { JsonLogger } from "@watcher/core";
import { loadProcessorConfig } from "./config.js";
import { makeNoteReceivedHandler } from "./handlers/note-received.handler.js";
import { DynamoInboundMessageReader } from "./repositories/inbound-message.reader.js";
import { S3MediaReader } from "./repositories/media.reader.js";
import { BedrockNoteAnalyzer } from "./repositories/note-analyzer.js";
import { EventBridgeNoteEventPublisher } from "./repositories/note-event.publisher.js";
import { DynamoNoteRepository } from "./repositories/note.repository.js";
import { ProcessNoteService } from "./services/process-note.service.js";

const config = loadProcessorConfig();
const logger = new JsonLogger({ service: "processor", stage: config.stage });

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const service = new ProcessNoteService(
  new DynamoInboundMessageReader(documentClient, config.tableName),
  new S3MediaReader(new S3Client({}), config.mediaBucket),
  new BedrockNoteAnalyzer(new BedrockRuntimeClient({}), config.modelId, logger),
  new DynamoNoteRepository(documentClient, config.tableName, logger),
  new EventBridgeNoteEventPublisher(new EventBridgeClient({}), config.eventBusName, logger),
  logger,
  { defaultTimezone: config.defaultTimezone, modelSupportsImages: config.modelSupportsImages },
);

export const handler = makeNoteReceivedHandler(service, logger);
