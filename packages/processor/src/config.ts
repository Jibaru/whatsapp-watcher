import { requireEnv } from "@watcher/core";

export interface ProcessorConfig {
  readonly stage: string;
  readonly isProduction: boolean;
  readonly tableName: string;
  readonly mediaBucket: string;
  readonly eventBusName: string;
  readonly modelId: string;
  readonly defaultTimezone: string;
}

const DEFAULT_MODEL_ID = "global.anthropic.claude-sonnet-4-6";
const DEFAULT_TIMEZONE = "America/Lima";

export function loadProcessorConfig(env: NodeJS.ProcessEnv = process.env): ProcessorConfig {
  const stage = requireEnv(env, "APP_STAGE");

  return {
    stage,
    isProduction: stage === "production",
    tableName: requireEnv(env, "TABLE_NAME"),
    mediaBucket: requireEnv(env, "MEDIA_BUCKET"),
    eventBusName: requireEnv(env, "EVENT_BUS_NAME"),
    modelId: env.BEDROCK_MODEL_ID?.trim() || DEFAULT_MODEL_ID,
    defaultTimezone: env.DEFAULT_TIMEZONE?.trim() || DEFAULT_TIMEZONE,
  };
}
