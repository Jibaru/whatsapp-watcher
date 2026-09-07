import { requireEnv } from "@watcher/core";

export interface ProcessorConfig {
  readonly stage: string;
  readonly isProduction: boolean;
}

export function loadProcessorConfig(env: NodeJS.ProcessEnv = process.env): ProcessorConfig {
  const stage = requireEnv(env, "APP_STAGE");

  return { stage, isProduction: stage === "production" };
}
