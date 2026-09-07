import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { SchedulerClient } from "@aws-sdk/client-scheduler";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { EmfMetrics, JsonLogger } from "@watcher/core";
import { loadProcessorConfig } from "./config.js";
import { makeNoteReceivedHandler } from "./handlers/note-received.handler.js";
import { DynamoInboundMessageReader } from "./repositories/inbound-message.reader.js";
import { S3MediaReader } from "./repositories/media.reader.js";
import { OpenAiNoteAnalyzer } from "./repositories/openai-note-analyzer.js";
import { EventBridgeNoteEventPublisher } from "./repositories/note-event.publisher.js";
import { DynamoFailedMessageRepository } from "./repositories/failed-message.repository.js";
import { DynamoNoteRepository } from "./repositories/note.repository.js";
import { DynamoReminderRepository } from "./repositories/reminder.repository.js";
import { EventBridgeReminderScheduler } from "./repositories/reminder.scheduler.js";
import { ProcessNoteService } from "./services/process-note.service.js";

const config = loadProcessorConfig();
const logger = new JsonLogger({ service: "processor", stage: config.stage });
const metrics = new EmfMetrics({
  namespace: "WhatsAppWatcher",
  dimensions: { stage: config.stage, service: "processor" },
});

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const service = new ProcessNoteService(
  new DynamoInboundMessageReader(documentClient, config.tableName),
  new S3MediaReader(new S3Client({}), config.mediaBucket),
  new OpenAiNoteAnalyzer(
    {
      apiKey: config.openAiApiKey,
      modelId: config.modelId,
      transcriptionModelId: config.transcriptionModelId,
    },
    logger,
    metrics,
  ),
  new DynamoNoteRepository(documentClient, config.tableName, logger, config.defaultTimezone),
  new EventBridgeNoteEventPublisher(new EventBridgeClient({}), config.eventBusName, logger),
  new DynamoFailedMessageRepository(documentClient, config.tableName, logger),
  new DynamoReminderRepository(documentClient, config.tableName, logger),
  new EventBridgeReminderScheduler(
    new SchedulerClient({}),
    { queueArn: config.dispatchQueueArn, roleArn: config.schedulerRoleArn },
    logger,
  ),
  logger,
  metrics,
  { defaultTimezone: config.defaultTimezone },
);

export const handler = makeNoteReceivedHandler(service, logger);
