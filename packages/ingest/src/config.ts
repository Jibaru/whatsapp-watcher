import { requireEnv } from "@watcher/core";

export interface IngestConfig {
  readonly stage: string;
  readonly isProduction: boolean;
  readonly kapsoWebhookSecret: string;
  readonly kapsoSecretHeader: string;
}

const DEFAULT_SECRET_HEADER = "x-kapso-webhook-secret";

export function loadIngestConfig(env: NodeJS.ProcessEnv = process.env): IngestConfig {
  const stage = requireEnv(env, "APP_STAGE");

  return {
    stage,
    isProduction: stage === "production",
    kapsoWebhookSecret: requireEnv(env, "KAPSO_WEBHOOK_SECRET"),
    kapsoSecretHeader: (env.KAPSO_SECRET_HEADER ?? DEFAULT_SECRET_HEADER).toLowerCase(),
  };
}
