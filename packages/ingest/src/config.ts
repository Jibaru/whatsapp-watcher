import { requireEnv } from "@watcher/core";

export interface IngestConfig {
  readonly stage: string;
  readonly isProduction: boolean;
  readonly kapsoWebhookSecret: string;
}

export function loadIngestConfig(env: NodeJS.ProcessEnv = process.env): IngestConfig {
  const stage = requireEnv(env, "APP_STAGE");

  return {
    stage,
    isProduction: stage === "production",
    kapsoWebhookSecret: requireEnv(env, "KAPSO_WEBHOOK_SECRET"),
  };
}
