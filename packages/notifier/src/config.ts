import { requireEnv } from "@watcher/core";

export interface NotifierConfig {
  readonly stage: string;
  readonly isProduction: boolean;
  readonly kapsoApiUrl: string;
  readonly kapsoApiKey: string;
  /** One number per deployment; a multi number setup would carry it in the event. */
  readonly kapsoPhoneNumberId: string;
  /** Fail-closed: outside production only these numbers can be written to. */
  readonly allowedRecipients: readonly string[];
}

const DEFAULT_API_URL = "https://api.kapso.ai";

export function loadNotifierConfig(env: NodeJS.ProcessEnv = process.env): NotifierConfig {
  const stage = requireEnv(env, "APP_STAGE");

  return {
    stage,
    isProduction: stage === "production",
    kapsoApiUrl: env.KAPSO_API_URL?.trim() || DEFAULT_API_URL,
    kapsoApiKey: requireEnv(env, "KAPSO_API_KEY"),
    kapsoPhoneNumberId: requireEnv(env, "KAPSO_PHONE_NUMBER_ID"),
    allowedRecipients: (env.ALLOWED_RECIPIENTS ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== ""),
  };
}
