export interface DigestNote {
  readonly noteId: string;
  readonly title: string;
  readonly summary: string;
  readonly priority: string;
  readonly createdAt: Date;
  readonly dueAt?: Date;
}

export interface DigestReminder {
  readonly alarmId: string;
  readonly title: string;
  readonly dueAt: Date;
}

export interface DailyDigestProps {
  readonly stage: string;
  readonly timeZone: string;
  readonly from: Date;
  readonly to: Date;
  readonly notes: readonly DigestNote[];
  readonly reminders: readonly DigestReminder[];
}

export class DailyDigest {
  readonly stage: string;
  readonly timeZone: string;
  readonly from: Date;
  readonly to: Date;
  readonly notes: readonly DigestNote[];
  readonly reminders: readonly DigestReminder[];

  private constructor(props: DailyDigestProps) {
    this.stage = props.stage;
    this.timeZone = props.timeZone;
    this.from = props.from;
    this.to = props.to;
    this.notes = props.notes;
    this.reminders = props.reminders;
  }

  static create(props: DailyDigestProps): DailyDigest {
    if (props.to.getTime() <= props.from.getTime()) {
      throw new Error("DailyDigest: the window ends before it starts");
    }

    return new DailyDigest(props);
  }

  /** A day with nothing captured and nothing coming is not worth an email. */
  isEmpty(): boolean {
    return this.notes.length === 0 && this.reminders.length === 0;
  }

  /**
   * SNS only accepts printable ASCII in a subject, and cuts it at 100 characters. Accents and
   * emoji arrive silently mangled, so they never leave here.
   */
  subject(): string {
    const parts = [`${this.notes.length} ${plural(this.notes.length, "nota", "notas")}`];

    if (this.reminders.length > 0) {
      parts.push(
        `${this.reminders.length} ${plural(this.reminders.length, "recordatorio", "recordatorios")}`,
      );
    }

    return `WhatsApp Watcher ${this.stage}: ${parts.join(", ")}`
      .normalize("NFD")
      .replace(/[^\x20-\x7E]/g, "")
      .slice(0, 100);
  }

  body(): string {
    const lines = [
      `Resumen de ${this.formatDate(this.from)} a ${this.formatDate(this.to)} (${this.timeZone}).`,
      "",
      `Notas anotadas: ${this.notes.length}`,
    ];

    for (const note of this.notes) {
      const reminder = note.dueAt === undefined ? "" : ` -> aviso ${this.formatDate(note.dueAt)}`;

      lines.push(`  - ${this.formatTime(note.createdAt)} [${note.priority}] ${note.title}${reminder}`);

      if (note.summary.trim() !== "" && note.summary !== note.title) {
        lines.push(`      ${note.summary}`);
      }
    }

    lines.push("", `Recordatorios en las proximas 24 h: ${this.reminders.length}`);

    for (const reminder of this.reminders) {
      lines.push(`  - ${this.formatDate(reminder.dueAt)}  ${reminder.title}`);
    }

    lines.push("", `-- WhatsApp Watcher (${this.stage})`);

    return lines.join("\n");
  }

  /**
   * Assembled part by part rather than taking whatever a locale hands back: the shape of a line
   * in this email should not depend on which ICU build the runtime ships with.
   */
  private parts(date: Date): Record<string, string> {
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: this.timeZone,
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });

    return Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  }

  private formatDate(date: Date): string {
    const parts = this.parts(date);

    return `${parts.day}/${parts.month} ${parts.hour}:${parts.minute}`;
  }

  private formatTime(date: Date): string {
    const parts = this.parts(date);

    return `${parts.hour}:${parts.minute}`;
  }
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}
