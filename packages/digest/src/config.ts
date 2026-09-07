import { requireEnv } from "@watcher/core";

export interface DigestConfig {
  readonly stage: string;
  readonly tableName: string;
  readonly topicArn: string;
  /** The timezone whose calendar day the notes were partitioned by. */
  readonly timeZone: string;
  /** How far back the summary looks. */
  readonly windowHours: number;
  /** How far ahead it lists what is still to come. */
  readonly lookaheadHours: number;
}

const DEFAULT_TIMEZONE = "America/Lima";

export function loadDigestConfig(env: NodeJS.ProcessEnv = process.env): DigestConfig {
  return {
    stage: requireEnv(env, "APP_STAGE"),
    tableName: requireEnv(env, "TABLE_NAME"),
    topicArn: requireEnv(env, "DIGEST_TOPIC_ARN"),
    timeZone: env.DEFAULT_TIMEZONE?.trim() || DEFAULT_TIMEZONE,
    windowHours: Number(env.DIGEST_WINDOW_HOURS ?? 24),
    lookaheadHours: Number(env.DIGEST_LOOKAHEAD_HOURS ?? 24),
  };
}
