import type {
  DispatchEnvelope,
  Logger,
  Metrics,
  NoteProcessedDetail,
  ReminderDueDetail,
} from "@watcher/core";
import { ALARM_DUE } from "@watcher/core";
import type { ReminderRepository } from "../repositories/reminder.repository.js";
import type { WhatsAppSender } from "../repositories/whatsapp.sender.js";

export interface NotifyNoteInput {
  readonly envelope: DispatchEnvelope;
}

export interface NotifyNoteOutput {
  readonly sent: boolean;
  readonly reason?: string;
}

export interface NotifyNoteOptions {
  readonly isProduction: boolean;
  readonly allowedRecipients: readonly string[];
}

export class NotifyNoteService {
  constructor(
    private readonly sender: WhatsAppSender,
    private readonly reminders: ReminderRepository,
    private readonly logger: Logger,
    private readonly metrics: Metrics,
    private readonly options: NotifyNoteOptions,
  ) {}

  async execute(input: NotifyNoteInput): Promise<NotifyNoteOutput> {
    const isReminder = input.envelope["detail-type"] === ALARM_DUE;
    const note = input.envelope.detail;

    if (!this.canWriteTo(note.owner, note.to)) {
      // Fail-closed: an empty allowlist outside production sends to nobody, on purpose.
      this.logger.warn("recipient_not_allowed", { noteId: note.noteId, isReminder });

      return { sent: false, reason: "recipient_not_allowed" };
    }

    if (isReminder && !(await this.reminders.isPending(note.pk, note.sk))) {
      // The queue is at-least-once, so a redelivered reminder must not ring twice.
      this.logger.info("reminder_already_sent", { alarmId: (note as ReminderDueDetail).alarmId });

      return { sent: false, reason: "already_sent" };
    }

    this.metrics.count("alarms_attempted");

    try {
      await this.sender.send({
        to: note.to,
        body: isReminder
          ? reminderBody(note as ReminderDueDetail)
          : confirmationBody(note as NoteProcessedDetail),
        kind: isReminder ? "reminder" : "confirmation",
      });
    } catch (error) {
      // Counted here so the ratio covers every reason a send did not make it, retryable or not.
      this.metrics.count("alarms_failed");

      throw error;
    }

    this.metrics.count("alarms_sent");

    if (isReminder) {
      // Marked after the send: a duplicate reminder is a nuisance, a lost one is a broken promise.
      await this.reminders.markSent(note.pk, note.sk);
    }

    this.logger.info("note_notified", { noteId: note.noteId, isReminder });

    return { sent: true };
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

function confirmationBody(note: NoteProcessedDetail): string {
  const reminder =
    note.dueAt === undefined ? "" : ` Te aviso el ${formatDueAt(note.dueAt)}.`;

  return `Anotado ✅ ${note.title}.${reminder}`;
}

function reminderBody(reminder: ReminderDueDetail): string {
  return `⏰ Recordatorio: ${reminder.title}`;
}

function formatDueAt(dueAt: string): string {
  return new Date(dueAt).toLocaleString("es-PE", { timeZone: "America/Lima" });
}
