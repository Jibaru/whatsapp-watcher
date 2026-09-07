import {
  describeError,
  isRetryable,
  DispatchEnvelopeSchema,
  PermanentError,
  runWithLogContext,
  type Logger,
} from "@watcher/core";
import type { SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import type { NotifyReminderService } from "../services/notify-reminder.service.js";

export function makeReminderDueHandler(service: NotifyReminderService, logger: Logger) {
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const batchItemFailures: { itemIdentifier: string }[] = [];

    for (const record of event.Records) {
      try {
        await handleRecord(record, service, logger);
      } catch (error) {
        if (isRetryable(error)) {
          batchItemFailures.push({ itemIdentifier: record.messageId });
        }
      }
    }

    return { batchItemFailures };
  };
}

async function handleRecord(
  record: SQSRecord,
  service: NotifyReminderService,
  logger: Logger,
): Promise<void> {
  const parsed = DispatchEnvelopeSchema.safeParse(JSON.parse(record.body));

  if (!parsed.success) {
    logger.error("reminder_event_unreadable", { sqsMessageId: record.messageId });

    throw new PermanentError(
      "reminder_event_unreadable",
      "The queued event does not match the contract",
    );
  }

  const envelope = parsed.data;
  const reminder = envelope.detail;

  await runWithLogContext(
    {
      correlationId: reminder.correlationId,
      conversationId: reminder.conversationId,
      messageId: reminder.messageId,
    },
    async () => {
      try {
        await service.execute({ envelope });
      } catch (error) {
        logger.error("notification_failed", {
          ...describeError(error),
          sqsMessageId: record.messageId,
        });

        throw error;
      }
    },
  );
}
