import type { DispatchEnvelope, Logger, Metrics, ReminderDueDetail } from "@watcher/core";
import { OutsideCustomerServiceWindowError } from "../domain/errors.js";
import type { ReminderRepository } from "../repositories/reminder.repository.js";
import type { WhatsAppSender } from "../repositories/whatsapp.sender.js";

export interface NotifyReminderInput {
  readonly envelope: DispatchEnvelope;
}

export interface NotifyReminderOutput {
  readonly sent: boolean;
  readonly reason?: string;
}

export interface NotifyReminderOptions {
  readonly isProduction: boolean;
  readonly allowedRecipients: readonly string[];
}

/**
 * The only thing that reaches the user's WhatsApp. Capturing a note answers nothing: what was
 * written comes back in the daily digest, and only a reminder is worth interrupting someone for.
 */
export class NotifyReminderService {
  constructor(
    private readonly sender: WhatsAppSender,
    private readonly reminders: ReminderRepository,
    private readonly logger: Logger,
    private readonly metrics: Metrics,
    private readonly options: NotifyReminderOptions,
  ) {}

  async execute(input: NotifyReminderInput): Promise<NotifyReminderOutput> {
    const reminder = input.envelope.detail;

    if (!this.canWriteTo(reminder.owner, reminder.to)) {
      // Fail-closed: an empty allowlist outside production sends to nobody, on purpose.
      this.logger.warn("recipient_not_allowed", {
        noteId: reminder.noteId,
        alarmId: reminder.alarmId,
      });

      return { sent: false, reason: "recipient_not_allowed" };
    }

    if (!(await this.reminders.isPending(reminder.pk, reminder.sk))) {
      // At-least-once delivery, plus a sweep that can enqueue what the scheduler already sent.
      this.logger.info("reminder_already_sent", { alarmId: reminder.alarmId });

      return { sent: false, reason: "already_sent" };
    }

    this.metrics.count("alarms_attempted");

    try {
      await this.sender.send({ to: reminder.to, body: reminderBody(reminder) });
    } catch (error) {
      // Counted here so the ratio covers every reason a send did not make it, retryable or not.
      this.metrics.count("alarms_failed");

      if (error instanceof OutsideCustomerServiceWindowError) {
        return await this.giveUp(reminder, error.code);
      }

      throw error;
    }

    this.metrics.count("alarms_sent");

    // Marked after the send: a duplicate reminder is a nuisance, a lost one is a broken promise.
    await this.reminders.markSent(reminder.pk, reminder.sk);

    this.logger.info("reminder_notified", {
      noteId: reminder.noteId,
      alarmId: reminder.alarmId,
    });

    return { sent: true };
  }

  /**
   * WhatsApp will not carry this one and no retry changes that: a closed window only reopens
   * when the user writes again, and this number cannot send templates. Recording it is the
   * whole point, since otherwise a reminder the user asked for vanishes without a trace and
   * the sweep would keep re-enqueueing it until it expired for the wrong reason.
   */
  private async giveUp(
    reminder: ReminderDueDetail,
    reason: string,
  ): Promise<NotifyReminderOutput> {
    this.metrics.count("reminders_undeliverable");
    await this.reminders.markUndeliverable(reminder.pk, reminder.sk, reason);

    return { sent: false, reason };
  }

  /** Matches either form, so the allowlist can be written the way a human would. */
  private canWriteTo(owner: string, address: string): boolean {
    return (
      this.options.isProduction ||
      this.options.allowedRecipients.includes(owner) ||
      this.options.allowedRecipients.includes(address)
    );
  }
}

function reminderBody(reminder: ReminderDueDetail): string {
  return `⏰ Recordatorio: ${reminder.title}`;
}
