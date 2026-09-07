import { alarmDispatchQueue } from "./events";
import { table } from "./storage";

export const evaluator = new sst.aws.Function("EvaluatorFunction", {
  handler: "packages/evaluator/src/main.handler",
  runtime: "nodejs24.x",
  memory: "512 MB",
  timeout: "60 seconds",
  logging: { retention: "2 weeks" },
  link: [table, alarmDispatchQueue],
  environment: {
    APP_STAGE: $app.stage,
    TABLE_NAME: table.name,
    DISPATCH_QUEUE_URL: alarmDispatchQueue.url,
  },
});

// Every five minutes, as the design says: often enough that a missed reminder is late by
// minutes, rare enough that it costs nothing.
export const evaluatorCron = new sst.aws.Cron("EvaluatorCron", {
  schedule: "rate(5 minutes)",
  function: evaluator.arn,
});
