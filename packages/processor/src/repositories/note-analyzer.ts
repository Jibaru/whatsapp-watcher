import type { NotePriority } from "../domain/note.js";

export interface AnalyzeNoteCommand {
  readonly text?: string;
  readonly image?: { readonly bytes: Uint8Array; readonly mimeType: string };
  readonly audio?: { readonly bytes: Uint8Array; readonly mimeType: string };
  readonly now: Date;
  readonly timezone: string;
}

export interface AnalyzedNote {
  readonly title: string;
  readonly summary: string;
  readonly tags: string[];
  readonly priority: NotePriority;
  readonly confidence: number;
  readonly dueAt?: string;
  /** Set when the note came from a voice message. */
  readonly transcript?: string;
}

export interface NoteAnalyzer {
  analyze(command: AnalyzeNoteCommand): Promise<AnalyzedNote>;
}
