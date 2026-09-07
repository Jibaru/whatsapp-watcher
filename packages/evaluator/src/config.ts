import { requireEnv } from "@watcher/core";

export interface EvaluatorConfig {
  readonly stage: string;
  readonly tableName: string;
  readonly dispatchQueueUrl: string;
  /** How long after its time a reminder must be before the sweep touches it. */
  readonly graceSeconds: number;
  /** Past this, nobody wants a reminder any more: it is expired instead of sent. */
  readonly giveUpSeconds: number;
}

export function loadEvaluatorConfig(env: NodeJS.ProcessEnv = process.env): EvaluatorConfig {
  return {
    stage: requireEnv(env, "APP_STAGE"),
    tableName: requireEnv(env, "TABLE_NAME"),
    dispatchQueueUrl: requireEnv(env, "DISPATCH_QUEUE_URL"),
    graceSeconds: Number(env.REMINDER_GRACE_SECONDS ?? 120),
    giveUpSeconds: Number(env.REMINDER_GIVE_UP_SECONDS ?? 3600),
  };
}
