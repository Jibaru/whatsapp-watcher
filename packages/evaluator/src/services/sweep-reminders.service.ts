import type { Logger, Metrics } from "@watcher/core";
import type { DispatchQueue } from "../repositories/dispatch.queue.js";
import type { DueReminderRepository } from "../repositories/due-reminder.repository.js";

export interface SweepRemindersOutput {
  readonly swept: number;
  readonly expired: number;
}

export interface SweepRemindersOptions {
  readonly graceSeconds: number;
  readonly giveUpSeconds: number;
  readonly limit?: number;
  readonly now?: () => Date;
}

export class SweepRemindersService {
  private readonly now: () => Date;

  constructor(
    private readonly reminders: DueReminderRepository,
    private readonly queue: DispatchQueue,
    private readonly logger: Logger,
    private readonly metrics: Metrics,
    private readonly options: SweepRemindersOptions,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  /**
   * The safety net under EventBridge Scheduler. A schedule that was never created, or one
   * whose delivery failed, leaves a reminder PENDING past its time and nothing else would
   * ever look at it again.
   */
  async execute(): Promise<SweepRemindersOutput> {
    const nowEpoch = Math.floor(this.now().getTime() / 1000);
    // The grace window keeps the sweep from racing the scheduler over the same reminder.
    const due = await this.reminders.findPendingBefore(
      nowEpoch - this.options.graceSeconds,
      this.options.limit ?? 25,
    );

    let swept = 0;
    let expired = 0;

    for (const reminder of due) {
      if (nowEpoch - reminder.dueAtEpoch > this.options.giveUpSeconds) {
        // Ringing hours late is worse than not ringing, and it would come back every sweep.
        await this.reminders.expire(reminder.pk, reminder.sk);
        expired += 1;
        continue;
      }

      await this.queue.enqueue({
        correlationId: reminder.correlationId ?? `sweep-${reminder.alarmId}`,
        messageId: reminder.messageId,
        noteId: reminder.noteId,
        alarmId: reminder.alarmId,
        pk: reminder.pk,
        sk: reminder.sk,
        to: reminder.owner,
        owner: reminder.owner,
        title: reminder.title,
        dueAt: new Date(reminder.dueAtEpoch * 1000).toISOString(),
      });
      swept += 1;
    }

    this.metrics.count("reminders_swept", swept);
    this.metrics.count("reminders_expired", expired);

    if (swept > 0 || expired > 0) {
      this.logger.warn("reminder_sweep_found_work", { swept, expired, candidates: due.length });
    }

    return { swept, expired };
  }
}
