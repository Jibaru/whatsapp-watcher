import { z } from "zod";

export const WATCHER_EVENT_SOURCE = "watcher.ingest";
export const NOTE_RECEIVED = "note.received";
export const NOTE_PROCESSED = "note.processed";
export const ALARM_DUE = "alarm.due";
export const SCHEDULER_EVENT_SOURCE = "watcher.scheduler";
export const PROCESSOR_EVENT_SOURCE = "watcher.processor";

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

export const NoteProcessedDetailSchema = z.object({
  correlationId: z.string(),
  conversationId: z.string().optional(),
  messageId: z.string(),
  noteId: z.string(),
  pk: z.string(),
  sk: z.string(),
  /** Delivery address as the provider expects it. */
  to: z.string(),
  /** Canonical identity, for anything that has to recognise the user. */
  owner: z.string(),
  title: z.string(),
  summary: z.string(),
  priority: z.string(),
  dueAt: z.string().optional(),
});

export type NoteProcessedDetail = z.infer<typeof NoteProcessedDetailSchema>;

/** Shape EventBridge puts in the SQS body when it delivers to a queue. */
export function envelopeSchemaOf<T extends z.ZodTypeAny>(detail: T) {
  return z.object({
    source: z.string(),
    "detail-type": z.string(),
    detail,
  });
}

export const ReminderDueDetailSchema = z.object({
  correlationId: z.string(),
  conversationId: z.string().optional(),
  messageId: z.string(),
  noteId: z.string(),
  alarmId: z.string(),
  pk: z.string(),
  sk: z.string(),
  to: z.string(),
  owner: z.string(),
  title: z.string(),
  dueAt: z.string(),
});

export type ReminderDueDetail = z.infer<typeof ReminderDueDetailSchema>;

export const EventBridgeEnvelopeSchema = envelopeSchemaOf(NoteReceivedDetailSchema);

/**
 * The dispatch queue carries two producers: the bus with a confirmation and the scheduler with a
 * reminder. The scheduler's input mimics the bus envelope so the consumer parses one shape.
 */
export const DispatchEnvelopeSchema = z.discriminatedUnion("detail-type", [
  z.object({
    source: z.string(),
    "detail-type": z.literal(NOTE_PROCESSED),
    detail: NoteProcessedDetailSchema,
  }),
  z.object({
    source: z.string(),
    "detail-type": z.literal(ALARM_DUE),
    detail: ReminderDueDetailSchema,
  }),
]);

export type DispatchEnvelope = z.infer<typeof DispatchEnvelopeSchema>;
