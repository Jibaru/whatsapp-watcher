import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SQSClient } from "@aws-sdk/client-sqs";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { EmfMetrics, JsonLogger } from "@watcher/core";
import { loadEvaluatorConfig } from "./config.js";
import { makeSweepHandler } from "./handlers/sweep.handler.js";
import { SqsDispatchQueue } from "./repositories/dispatch.queue.js";
import { DynamoDueReminderRepository } from "./repositories/due-reminder.repository.js";
import { SweepRemindersService } from "./services/sweep-reminders.service.js";

const config = loadEvaluatorConfig();
const logger = new JsonLogger({ service: "evaluator", stage: config.stage });
const metrics = new EmfMetrics({
  namespace: "WhatsAppWatcher",
  dimensions: { stage: config.stage, service: "evaluator" },
});

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const service = new SweepRemindersService(
  new DynamoDueReminderRepository(documentClient, config.tableName, logger),
  new SqsDispatchQueue(new SQSClient({}), config.dispatchQueueUrl, logger),
  logger,
  metrics,
  { graceSeconds: config.graceSeconds, giveUpSeconds: config.giveUpSeconds },
);

export const handler = makeSweepHandler(service, logger);
