import {
  ConflictException,
  CreateScheduleCommand,
  type SchedulerClient,
} from "@aws-sdk/client-scheduler";
import { ALARM_DUE, SCHEDULER_EVENT_SOURCE, type Logger, type ReminderDueDetail } from "@watcher/core";

export interface ReminderScheduler {
  schedule(detail: ReminderDueDetail, dueAt: Date): Promise<void>;
}

export interface SchedulerOptions {
  readonly queueArn: string;
  readonly roleArn: string;
  readonly groupName?: string;
}

export class EventBridgeReminderScheduler implements ReminderScheduler {
  constructor(
    private readonly client: SchedulerClient,
    private readonly options: SchedulerOptions,
    private readonly logger: Logger,
  ) {}

  async schedule(detail: ReminderDueDetail, dueAt: Date): Promise<void> {
    const name = scheduleName(detail.alarmId);

    try {
      await this.client.send(
        new CreateScheduleCommand({
          Name: name,
          GroupName: this.options.groupName,
          // The queue consumer expects the bus envelope, so the schedule imitates it.
          Target: {
            Arn: this.options.queueArn,
            RoleArn: this.options.roleArn,
            Input: JSON.stringify({
              source: SCHEDULER_EVENT_SOURCE,
              "detail-type": ALARM_DUE,
              detail,
            }),
          },
          ScheduleExpression: `at(${toScheduleInstant(dueAt)})`,
          ScheduleExpressionTimezone: "UTC",
          FlexibleTimeWindow: { Mode: "OFF" },
          // One-time schedules would pile up forever otherwise.
          ActionAfterCompletion: "DELETE",
        }),
      );

      this.logger.info("reminder_scheduled", { name, dueAt: dueAt.toISOString() });
    } catch (error) {
      // Reprocessing the same note finds its schedule already there, which is the point.
      if (error instanceof ConflictException) {
        this.logger.info("reminder_already_scheduled", { name });

        return;
      }

      throw error;
    }
  }
}

/** Schedule names allow letters, digits, dots, dashes and underscores. */
export function scheduleName(alarmId: string): string {
  return `watcher-${alarmId.replace(/[^A-Za-z0-9._-]/g, "_")}`.slice(0, 64);
}

/** Scheduler wants at(yyyy-MM-ddTHH:mm:ss), with no milliseconds and no zone suffix. */
export function toScheduleInstant(dueAt: Date): string {
  return dueAt.toISOString().replace(/\.\d{3}Z$/, "");
}
