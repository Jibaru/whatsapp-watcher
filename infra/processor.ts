import { noteProcessingQueue } from "./events";

export const processor = new sst.aws.Function("ProcessorFunction", {
  handler: "packages/processor/src/main.handler",
  runtime: "nodejs24.x",
  memory: "512 MB",
  timeout: "30 seconds",
  logging: { retention: "2 weeks" },
  environment: { APP_STAGE: $app.stage },
  // The function is declared here, not inline in subscribe(), so SST does not wire the
  // consumer permissions for us.
  permissions: [
    {
      actions: ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"],
      resources: [noteProcessingQueue.arn],
    },
  ],
});

noteProcessingQueue.subscribe(processor.arn, {
  // One poisoned record must not drag its whole batch back onto the queue.
  batch: { partialResponses: true },
});
