import { JsonLogger } from "@watcher/core";
import { loadNotifierConfig } from "./config.js";
import { makeNoteProcessedHandler } from "./handlers/note-processed.handler.js";
import { KapsoWhatsAppSender } from "./repositories/kapso-whatsapp.sender.js";
import { NotifyNoteService } from "./services/notify-note.service.js";

const config = loadNotifierConfig();
const logger = new JsonLogger({ service: "notifier", stage: config.stage });

const sender = new KapsoWhatsAppSender(
  {
    apiUrl: config.kapsoApiUrl,
    apiKey: config.kapsoApiKey,
    phoneNumberId: config.kapsoPhoneNumberId,
  },
  logger,
);

const service = new NotifyNoteService(sender, logger, {
  isProduction: config.isProduction,
  allowedRecipients: config.allowedRecipients,
});

export const handler = makeNoteProcessedHandler(service, logger);
