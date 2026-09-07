import { z } from "zod";

export const WATCHER_EVENT_SOURCE = "watcher.ingest";
export const NOTE_RECEIVED = "note.received";

/** The contract between the lambdas: the producer builds it, the consumer parses it. */
export const NoteReceivedDetailSchema = z.object({
  correlationId: z.string(),
  conversationId: z.string().optional(),
  messageId: z.string(),
  pk: z.string(),
  sk: z.string(),
  from: z.string(),
  kind: z.string(),
  hasMedia: z.boolean(),
  mediaKey: z.string().optional(),
  receivedAt: z.string(),
});

export type NoteReceivedDetail = z.infer<typeof NoteReceivedDetailSchema>;

/** Shape EventBridge puts in the SQS body when it delivers to a queue. */
export const EventBridgeEnvelopeSchema = z.object({
  source: z.string(),
  "detail-type": z.string(),
  detail: NoteReceivedDetailSchema,
});
