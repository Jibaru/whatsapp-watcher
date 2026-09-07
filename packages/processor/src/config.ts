import { requireEnv } from "@watcher/core";

export interface ProcessorConfig {
  readonly stage: string;
  readonly isProduction: boolean;
  readonly tableName: string;
  readonly mediaBucket: string;
  readonly eventBusName: string;
  readonly openAiApiKey: string;
  readonly modelId: string;
  readonly transcriptionModelId: string;
  readonly defaultTimezone: string;
}

const DEFAULT_MODEL_ID = "gpt-5-mini";
const DEFAULT_TRANSCRIPTION_MODEL_ID = "whisper-1";
const DEFAULT_TIMEZONE = "America/Lima";

export function loadProcessorConfig(env: NodeJS.ProcessEnv = process.env): ProcessorConfig {
  const stage = requireEnv(env, "APP_STAGE");

  return {
    stage,
    isProduction: stage === "production",
    tableName: requireEnv(env, "TABLE_NAME"),
    mediaBucket: requireEnv(env, "MEDIA_BUCKET"),
    eventBusName: requireEnv(env, "EVENT_BUS_NAME"),
    openAiApiKey: requireEnv(env, "OPENAI_API_KEY"),
    modelId: env.OPENAI_MODEL_ID?.trim() || DEFAULT_MODEL_ID,
    transcriptionModelId: env.OPENAI_TRANSCRIPTION_MODEL_ID?.trim() || DEFAULT_TRANSCRIPTION_MODEL_ID,
    defaultTimezone: env.DEFAULT_TIMEZONE?.trim() || DEFAULT_TIMEZONE,
  };
}
