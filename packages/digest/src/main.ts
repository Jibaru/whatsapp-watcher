import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SNSClient } from "@aws-sdk/client-sns";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { EmfMetrics, JsonLogger } from "@watcher/core";
import { loadDigestConfig } from "./config.js";
import { makeDigestHandler } from "./handlers/digest.handler.js";
import { DynamoDailyNoteRepository } from "./repositories/daily-note.repository.js";
import { SnsDigestPublisher } from "./repositories/digest.publisher.js";
import { DynamoUpcomingReminderRepository } from "./repositories/upcoming-reminder.repository.js";
import { BuildDailyDigestService } from "./services/build-daily-digest.service.js";

const config = loadDigestConfig();
const logger = new JsonLogger({ service: "digest", stage: config.stage });
const metrics = new EmfMetrics({
  namespace: "WhatsAppWatcher",
  dimensions: { stage: config.stage, service: "digest" },
});

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const service = new BuildDailyDigestService(
  new DynamoDailyNoteRepository(documentClient, config.tableName, config.timeZone, logger),
  new DynamoUpcomingReminderRepository(documentClient, config.tableName),
  new SnsDigestPublisher(new SNSClient({}), config.topicArn, logger),
  logger,
  metrics,
  {
    stage: config.stage,
    timeZone: config.timeZone,
    windowHours: config.windowHours,
    lookaheadHours: config.lookaheadHours,
  },
);

export const handler = makeDigestHandler(service, logger);
