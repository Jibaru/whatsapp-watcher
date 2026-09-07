import { createOpenAI } from "@ai-sdk/openai";
import type { Logger, WatcherError } from "@watcher/core";
import { generateObject, transcribe } from "ai";
import { z } from "zod";
import {
  ModelOutputInvalidError,
  ModelRejectedError,
  ModelUnavailableError,
} from "../domain/errors.js";
import type { AnalyzedNote, AnalyzeNoteCommand, NoteAnalyzer } from "./note-analyzer.js";

const NoteSchema = z.object({
  title: z.string().describe("Five words at most, in the language of the note"),
  summary: z.string().describe("One or two sentences"),
  tags: z.array(z.string()).describe("Up to four lowercase tags"),
  priority: z.enum(["low", "normal", "high"]),
  confidence: z.number().describe("0 to 1, how sure you are of the reading"),
  // Nullable, not optional: OpenAI structured outputs demand every key in required.
  dueAt: z
    .string()
    .nullable()
    .describe("ISO 8601 instant when the user asked to be reminded. null if there is none."),
});

export interface OpenAiAnalyzerOptions {
  readonly apiKey: string;
  readonly modelId: string;
  readonly transcriptionModelId: string;
}

export class OpenAiNoteAnalyzer implements NoteAnalyzer {
  private readonly openai;

  constructor(
    private readonly options: OpenAiAnalyzerOptions,
    private readonly logger: Logger,
  ) {
    this.openai = createOpenAI({ apiKey: options.apiKey });
  }

  async analyze(command: AnalyzeNoteCommand): Promise<AnalyzedNote> {
    const transcript = await this.transcribeIfNeeded(command);
    const started = Date.now();

    try {
      const result = await generateObject({
        model: this.openai(this.options.modelId),
        schema: NoteSchema,
        system: systemPrompt(command),
        messages: [{ role: "user", content: userContent(command, transcript) }],
      });

      this.logger.info("note_analyzed", {
        modelId: this.options.modelId,
        latencyMs: Date.now() - started,
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
      });

      return { ...result.object, dueAt: result.object.dueAt ?? undefined, transcript };
    } catch (error) {
      throw toAnalyzerError(error);
    }
  }

  private async transcribeIfNeeded(command: AnalyzeNoteCommand): Promise<string | undefined> {
    if (command.audio === undefined) {
      return undefined;
    }

    const started = Date.now();

    try {
      const result = await transcribe({
        model: this.openai.transcription(this.options.transcriptionModelId),
        audio: command.audio.bytes,
      });

      this.logger.info("audio_transcribed", {
        modelId: this.options.transcriptionModelId,
        latencyMs: Date.now() - started,
        characters: result.text.length,
      });

      return result.text;
    } catch (error) {
      throw toAnalyzerError(error);
    }
  }
}

const PERMANENT_STATUS = new Set([400, 401, 403, 404, 413, 422]);

/**
 * The taxonomy only cares whether another attempt could change the outcome: a rate limit or a
 * gateway hiccup deserves one, a rejected key or an unreadable answer never will.
 */
export function toAnalyzerError(error: unknown): WatcherError {
  if (error instanceof ModelOutputInvalidError) {
    return error;
  }

  const name = error instanceof Error ? error.name : "Unknown";

  if (name === "NoObjectGeneratedError" || name === "TypeValidationError") {
    return new ModelOutputInvalidError(name);
  }

  const status = statusOf(error);

  if (status !== undefined && PERMANENT_STATUS.has(status)) {
    return new ModelRejectedError(`${name} (HTTP ${status})`, error);
  }

  return new ModelUnavailableError(error);
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const status = (error as { statusCode?: unknown }).statusCode;

  return typeof status === "number" ? status : undefined;
}

function systemPrompt(command: AnalyzeNoteCommand): string {
  return [
    "You turn WhatsApp messages into structured notes.",
    "Write the title, summary and tags in the same language as the message.",
    `The current instant is ${command.now.toISOString()} and the user's timezone is ${command.timezone}.`,
    "Resolve relative dates against that instant, and only set dueAt when the user actually asks to be reminded.",
  ].join(" ");
}

type UserContent = Array<
  | { type: "text"; text: string }
  | { type: "image"; image: Uint8Array; mediaType: string }
>;

function userContent(command: AnalyzeNoteCommand, transcript: string | undefined): UserContent {
  const content: UserContent = [];

  if (command.image !== undefined) {
    content.push({
      type: "image",
      image: command.image.bytes,
      mediaType: command.image.mimeType,
    });
  }

  const text = [transcript, command.text].filter((part) => part !== undefined && part.trim() !== "");

  content.push({
    type: "text",
    text:
      text.length > 0
        ? text.join("\n\n")
        : "The message carries no text. Describe the attached image as a note.",
  });

  return content;
}
