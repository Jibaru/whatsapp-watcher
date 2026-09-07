import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import { ALARM_DUE, type Logger, type ReminderDueDetail } from "@watcher/core";

export const EVALUATOR_EVENT_SOURCE = "watcher.evaluator";

export interface DispatchQueue {
  enqueue(detail: ReminderDueDetail): Promise<void>;
}

export class SqsDispatchQueue implements DispatchQueue {
  constructor(
    private readonly client: SQSClient,
    private readonly queueUrl: string,
    private readonly logger: Logger,
  ) {}

  async enqueue(detail: ReminderDueDetail): Promise<void> {
    // Same envelope the bus and the scheduler use, so the notifier does not learn a third shape.
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify({
          source: EVALUATOR_EVENT_SOURCE,
          "detail-type": ALARM_DUE,
          detail,
        }),
      }),
    );

    this.logger.info("reminder_swept", { alarmId: detail.alarmId });
  }
}
