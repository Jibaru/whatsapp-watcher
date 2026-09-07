import { requireEnv } from "@watcher/core";

export interface IngestConfig {
  readonly stage: string;
  readonly isProduction: boolean;
  readonly kapsoWebhookSecret: string;
  readonly mediaBucket: string;
  readonly tableName: string;
  readonly mediaMaxBytes: number;
}

const DEFAULT_MEDIA_MAX_BYTES = 16 * 1024 * 1024;

export function loadIngestConfig(env: NodeJS.ProcessEnv = process.env): IngestConfig {
  const stage = requireEnv(env, "APP_STAGE");

  return {
    stage,
    isProduction: stage === "production",
    kapsoWebhookSecret: requireEnv(env, "KAPSO_WEBHOOK_SECRET"),
    mediaBucket: requireEnv(env, "MEDIA_BUCKET"),
    tableName: requireEnv(env, "TABLE_NAME"),
    mediaMaxBytes: Number(env.MEDIA_MAX_BYTES ?? DEFAULT_MEDIA_MAX_BYTES),
  };
}
