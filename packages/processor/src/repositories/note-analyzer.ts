import {
  ConverseCommand,
  type BedrockRuntimeClient,
  type ContentBlock,
  type ImageFormat,
} from "@aws-sdk/client-bedrock-runtime";
import type { Logger } from "@watcher/core";
import {
  ModelOutputInvalidError,
  ModelRejectedError,
  ModelUnavailableError,
} from "../domain/errors.js";
import type { NotePriority } from "../domain/note.js";

export interface AnalyzeNoteCommand {
  readonly text?: string;
  readonly image?: { readonly bytes: Uint8Array; readonly mimeType: string };
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
}

export interface NoteAnalyzer {
  analyze(command: AnalyzeNoteCommand): Promise<AnalyzedNote>;
}

const TOOL_NAME = "record_note";

const PERMANENT_BEDROCK_ERRORS = new Set([
  "AccessDeniedException",
  "ValidationException",
  "ResourceNotFoundException",
  "SerializationException",
]);

const IMAGE_FORMATS: Record<string, ImageFormat> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

const TOOL_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Five words at most, in the language of the note" },
    summary: { type: "string", description: "One or two sentences" },
    tags: { type: "array", items: { type: "string" }, description: "Up to four lowercase tags" },
    priority: { type: "string", enum: ["low", "normal", "high"] },
    confidence: { type: "number", description: "0 to 1, how sure you are of the reading" },
    dueAt: {
      type: "string",
      description: "ISO 8601 instant when the user asked to be reminded. Omit if none.",
    },
  },
  required: ["title", "summary", "tags", "priority", "confidence"],
};

export class BedrockNoteAnalyzer implements NoteAnalyzer {
  constructor(
    private readonly client: BedrockRuntimeClient,
    private readonly modelId: string,
    private readonly logger: Logger,
  ) {}

  async analyze(command: AnalyzeNoteCommand): Promise<AnalyzedNote> {
    const started = Date.now();
    const response = await this.invoke(command);

    const toolUse = response.output?.message?.content?.find((block) => block.toolUse !== undefined)
      ?.toolUse;

    if (toolUse?.input === undefined) {
      throw new ModelOutputInvalidError("no tool call in the answer");
    }

    this.logger.info("bedrock_analyzed", {
      modelId: this.modelId,
      latencyMs: Date.now() - started,
      inputTokens: response.usage?.inputTokens,
      outputTokens: response.usage?.outputTokens,
      stopReason: response.stopReason,
    });

    return normalize(toolUse.input);
  }

  private async invoke(command: AnalyzeNoteCommand) {
    try {
      return await this.client.send(
        new ConverseCommand({
          modelId: this.modelId,
          system: [{ text: systemPrompt(command) }],
          messages: [{ role: "user", content: userContent(command) }],
          toolConfig: {
            tools: [
              {
                toolSpec: {
                  name: TOOL_NAME,
                  description: "Records the structured note extracted from the message",
                  inputSchema: { json: TOOL_SCHEMA },
                },
              },
            ],
            // Forcing the tool is what makes the answer a schema instead of prose.
            toolChoice: { tool: { name: TOOL_NAME } },
          },
          inferenceConfig: { maxTokens: 1024, temperature: 0 },
        }),
      );
    } catch (error) {
      const name = error instanceof Error ? error.name : "Unknown";

      // Only capacity problems are worth another attempt; the rest are configuration.
      if (PERMANENT_BEDROCK_ERRORS.has(name)) {
        throw new ModelRejectedError(name, error);
      }

      throw new ModelUnavailableError(error);
    }
  }
}

function systemPrompt(command: AnalyzeNoteCommand): string {
  return [
    "You turn WhatsApp messages into structured notes.",
    "Answer only through the record_note tool.",
    "Write the title, summary and tags in the same language as the message.",
    `The current instant is ${command.now.toISOString()} and the user's timezone is ${command.timezone}.`,
    "Resolve relative dates against that instant, and only set dueAt when the user actually asks to be reminded.",
  ].join(" ");
}

function userContent(command: AnalyzeNoteCommand): ContentBlock[] {
  const content: ContentBlock[] = [];

  if (command.image !== undefined) {
    const format = IMAGE_FORMATS[command.image.mimeType];

    if (format === undefined) {
      throw new ModelOutputInvalidError(`unsupported image type ${command.image.mimeType}`);
    }

    content.push({ image: { format, source: { bytes: command.image.bytes } } });
  }

  content.push({
    text:
      command.text !== undefined && command.text.trim() !== ""
        ? command.text
        : "The message carries no text. Describe the attached image as a note.",
  });

  return content;
}

function normalize(input: unknown): AnalyzedNote {
  if (typeof input !== "object" || input === null) {
    throw new ModelOutputInvalidError("the tool input was not an object");
  }

  const raw = input as Record<string, unknown>;
  const title = typeof raw.title === "string" ? raw.title.trim() : "";

  if (title === "") {
    throw new ModelOutputInvalidError("the note has no title");
  }

  return {
    title,
    summary: typeof raw.summary === "string" ? raw.summary : "",
    tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === "string") : [],
    priority: toPriority(raw.priority),
    confidence: typeof raw.confidence === "number" ? raw.confidence : 0,
    dueAt: typeof raw.dueAt === "string" && raw.dueAt.trim() !== "" ? raw.dueAt : undefined,
  };
}

function toPriority(value: unknown): NotePriority {
  return value === "low" || value === "high" ? value : "normal";
}
