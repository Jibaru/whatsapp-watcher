import { alarmDispatchQueue, bus, noteProcessingQueue, schedulerRole } from "./events";

export const openAiApiKey = new sst.Secret("OpenAiApiKey");
import { mediaBucket, table } from "./storage";

export const processor = new sst.aws.Function("ProcessorFunction", {
  handler: "packages/processor/src/main.handler",
  runtime: "nodejs24.x",
  memory: "512 MB",
  timeout: "30 seconds",
  logging: { retention: "2 weeks" },
  link: [table, mediaBucket, bus],
  environment: {
    APP_STAGE: $app.stage,
    TABLE_NAME: table.name,
    MEDIA_BUCKET: mediaBucket.name,
    EVENT_BUS_NAME: bus.name,
    DISPATCH_QUEUE_ARN: alarmDispatchQueue.arn,
    SCHEDULER_ROLE_ARN: schedulerRole.arn,
    OPENAI_API_KEY: openAiApiKey.value,
  },
  // The function is declared here, not inline in subscribe(), so SST does not wire the
  // consumer permissions for us.
  permissions: [
    {
      actions: ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"],
      resources: [noteProcessingQueue.arn],
    },
    {
      actions: ["scheduler:CreateSchedule", "scheduler:GetSchedule", "scheduler:DeleteSchedule"],
      resources: ["*"],
    },
    // Creating a schedule means handing the scheduler a role, and that needs saying so.
    { actions: ["iam:PassRole"], resources: [schedulerRole.arn] },
  ],
});

noteProcessingQueue.subscribe(processor.arn, {
  // One poisoned record must not drag its whole batch back onto the queue.
  batch: { partialResponses: true },
});
