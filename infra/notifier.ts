import { alarmDispatchQueue } from "./events";
import { table } from "./storage";

export const kapsoApiKey = new sst.Secret("KapsoApiKey");
export const kapsoPhoneNumberId = new sst.Secret("KapsoPhoneNumberId");
// Not a secret, but the same mechanism keeps it out of the deploying machine's environment.
export const allowedRecipients = new sst.Secret("AllowedRecipients", "");

export const notifier = new sst.aws.Function("NotifierFunction", {
  handler: "packages/notifier/src/main.handler",
  runtime: "nodejs24.x",
  memory: "512 MB",
  timeout: "30 seconds",
  logging: { retention: "2 weeks" },
  link: [table],
  environment: {
    APP_STAGE: $app.stage,
    KAPSO_API_KEY: kapsoApiKey.value,
    KAPSO_PHONE_NUMBER_ID: kapsoPhoneNumberId.value,
    ALLOWED_RECIPIENTS: allowedRecipients.value,
    TABLE_NAME: table.name,
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
