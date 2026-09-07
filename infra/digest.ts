import { subscribeEmails } from "./alerts";
import { table } from "./storage";

/**
 * Its own topic, sharing the address list with ops-alerts. Two topics instead of one so that
 * unsubscribing from the daily summary never costs anyone their alarms.
 */
export const dailyDigest = new sst.aws.SnsTopic("DailyDigest");

subscribeEmails("DailyDigestEmail", dailyDigest);

export const digest = new sst.aws.Function("DigestFunction", {
  handler: "packages/digest/src/main.handler",
  runtime: "nodejs24.x",
  memory: "512 MB",
  timeout: "60 seconds",
  logging: { retention: "2 weeks" },
  link: [table, dailyDigest],
  environment: {
    APP_STAGE: $app.stage,
    TABLE_NAME: table.name,
    DIGEST_TOPIC_ARN: dailyDigest.arn,
  },
});

// 13:00 UTC is 08:00 in America/Lima: the cut falls overnight, so a day is never split in two.
export const digestCron = new sst.aws.Cron("DigestCron", {
  schedule: "cron(0 13 * * ? *)",
  function: digest.arn,
});
