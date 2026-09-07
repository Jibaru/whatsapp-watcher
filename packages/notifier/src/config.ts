import { requireEnv } from "@watcher/core";

export interface NotifierConfig {
  readonly stage: string;
  readonly isProduction: boolean;
  /** Fail-closed: outside production only these numbers can be written to. */
  readonly allowedRecipients: readonly string[];
}

export function loadNotifierConfig(env: NodeJS.ProcessEnv = process.env): NotifierConfig {
  const stage = requireEnv(env, "APP_STAGE");

  return {
    stage,
    isProduction: stage === "production",
    allowedRecipients: (env.ALLOWED_RECIPIENTS ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== ""),
  };
}
