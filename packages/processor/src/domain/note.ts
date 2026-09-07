export type NotePriority = "low" | "normal" | "high";

export interface NoteProps {
  readonly noteId: string;
  readonly messageId: string;
  readonly owner: string;
  readonly title: string;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly priority: NotePriority;
  readonly confidence: number;
  readonly createdAt: Date;
  readonly dueAt?: Date;
  readonly mediaKey?: string;
}

export class Note {
  readonly noteId: string;
  readonly messageId: string;
  readonly owner: string;
  readonly title: string;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly priority: NotePriority;
  readonly confidence: number;
  readonly createdAt: Date;
  readonly dueAt?: Date;
  readonly mediaKey?: string;

  private constructor(props: NoteProps) {
    this.noteId = props.noteId;
    this.messageId = props.messageId;
    this.owner = props.owner;
    this.title = props.title;
    this.summary = props.summary;
    this.tags = props.tags;
    this.priority = props.priority;
    this.confidence = props.confidence;
    this.createdAt = props.createdAt;
    this.dueAt = props.dueAt;
    this.mediaKey = props.mediaKey;
  }

  static create(props: NoteProps): Note {
    if (props.title.trim() === "") {
      throw new Error("Note: title cannot be empty");
    }

    return new Note(props);
  }

  hasReminder(): boolean {
    return this.dueAt !== undefined;
  }

  isUrgent(): boolean {
    return this.priority === "high";
  }

  toLogRecord(): Record<string, unknown> {
    return {
      noteId: this.noteId,
      messageId: this.messageId,
      priority: this.priority,
      tags: this.tags,
      confidence: this.confidence,
      hasReminder: this.hasReminder(),
      dueAt: this.dueAt?.toISOString(),
    };
  }
}
