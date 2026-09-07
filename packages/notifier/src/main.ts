import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { EmfMetrics, JsonLogger } from "@watcher/core";
import { loadNotifierConfig } from "./config.js";
import { makeReminderDueHandler } from "./handlers/reminder-due.handler.js";
import { KapsoWhatsAppSender } from "./repositories/kapso-whatsapp.sender.js";
import { DynamoReminderRepository } from "./repositories/reminder.repository.js";
import { NotifyReminderService } from "./services/notify-reminder.service.js";

const config = loadNotifierConfig();
const logger = new JsonLogger({ service: "notifier", stage: config.stage });
const metrics = new EmfMetrics({
  namespace: "WhatsAppWatcher",
  dimensions: { stage: config.stage, service: "notifier" },
});

const sender = new KapsoWhatsAppSender(
  {
    apiUrl: config.kapsoApiUrl,
    apiKey: config.kapsoApiKey,
    phoneNumberId: config.kapsoPhoneNumberId,
  },
  logger,
);

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const reminders = new DynamoReminderRepository(documentClient, config.tableName, logger);

const service = new NotifyReminderService(sender, reminders, logger, metrics, {
  isProduction: config.isProduction,
  allowedRecipients: config.allowedRecipients,
});

export const handler = makeReminderDueHandler(service, logger);
