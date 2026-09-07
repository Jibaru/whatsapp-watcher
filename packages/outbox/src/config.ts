import { requireEnv } from "@watcher/core";

export interface OutboxConfig {
  readonly stage: string;
  readonly eventBusName: string;
}

export function loadOutboxConfig(env: NodeJS.ProcessEnv = process.env): OutboxConfig {
  return {
    stage: requireEnv(env, "APP_STAGE"),
    eventBusName: requireEnv(env, "EVENT_BUS_NAME"),
  };
}
