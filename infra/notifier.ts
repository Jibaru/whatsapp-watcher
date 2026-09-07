import { alarmDispatchQueue } from "./events";

export const notifier = new sst.aws.Function("NotifierFunction", {
  handler: "packages/notifier/src/main.handler",
  runtime: "nodejs24.x",
  memory: "512 MB",
  timeout: "30 seconds",
  logging: { retention: "2 weeks" },
  environment: {
    APP_STAGE: $app.stage,
    ALLOWED_RECIPIENTS: process.env.ALLOWED_RECIPIENTS ?? "",
  },
  permissions: [
    {
      actions: ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"],
      resources: [alarmDispatchQueue.arn],
    },
  ],
});

alarmDispatchQueue.subscribe(notifier.arn, {
  batch: { partialResponses: true },
});
