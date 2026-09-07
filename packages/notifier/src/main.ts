import { JsonLogger } from "@watcher/core";
import { loadNotifierConfig } from "./config.js";
import { makeNoteProcessedHandler } from "./handlers/note-processed.handler.js";
import { LoggingWhatsAppSender } from "./repositories/whatsapp.sender.js";
import { NotifyNoteService } from "./services/notify-note.service.js";

const config = loadNotifierConfig();
const logger = new JsonLogger({ service: "notifier", stage: config.stage });

const service = new NotifyNoteService(new LoggingWhatsAppSender(logger), logger, {
  isProduction: config.isProduction,
  allowedRecipients: config.allowedRecipients,
});

export const handler = makeNoteProcessedHandler(service, logger);
