import type { Logger, Metrics, NoteProcessedDetail } from "@watcher/core";
import type { WhatsAppSender } from "../repositories/whatsapp.sender.js";

export interface NotifyNoteInput {
  readonly note: NoteProcessedDetail;
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
    private readonly logger: Logger,
    private readonly metrics: Metrics,
    private readonly options: NotifyNoteOptions,
  ) {}

  async execute(input: NotifyNoteInput): Promise<NotifyNoteOutput> {
    const { to, owner } = input.note;

    if (!this.canWriteTo(owner, to)) {
      // Fail-closed: an empty allowlist outside production sends to nobody, on purpose.
      this.logger.warn("recipient_not_allowed", { noteId: input.note.noteId });

      return { sent: false, reason: "recipient_not_allowed" };
    }

    this.metrics.count("alarms_attempted");

    try {
      await this.sender.send({ to, body: confirmationBody(input.note) });
    } catch (error) {
      // Counted here so the ratio covers every reason a send did not make it, retryable or not.
      this.metrics.count("alarms_failed");

      throw error;
    }

    this.metrics.count("alarms_sent");

    this.logger.info("note_notified", {
      noteId: input.note.noteId,
      hasReminder: input.note.dueAt !== undefined,
    });

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
    note.dueAt === undefined ? "" : ` Te aviso el ${new Date(note.dueAt).toLocaleString("es-PE")}.`;

  return `Anotado ✅ ${note.title}.${reminder}`;
}
