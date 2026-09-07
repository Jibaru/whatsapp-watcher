import { JsonLogger } from "@watcher/core";
import { loadProcessorConfig } from "./config.js";
import { makeNoteReceivedHandler } from "./handlers/note-received.handler.js";
import { ProcessNoteService } from "./services/process-note.service.js";

const config = loadProcessorConfig();
const logger = new JsonLogger({ service: "processor", stage: config.stage });

export const handler = makeNoteReceivedHandler(new ProcessNoteService(logger), logger);
