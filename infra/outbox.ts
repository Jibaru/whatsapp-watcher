import { bus } from "./events";
import { table } from "./storage";

export const outbox = new sst.aws.Function("OutboxFunction", {
  handler: "packages/outbox/src/main.handler",
  runtime: "nodejs24.x",
  memory: "512 MB",
  timeout: "30 seconds",
  logging: { retention: "2 weeks" },
  link: [bus],
  environment: {
    APP_STAGE: $app.stage,
    EVENT_BUS_NAME: bus.name,
  },
  // Declared outside subscribe(), so the stream consumer permissions are ours to grant.
  permissions: [
    {
      actions: [
        "dynamodb:GetRecords",
        "dynamodb:GetShardIterator",
        "dynamodb:DescribeStream",
        "dynamodb:ListStreams",
      ],
      resources: [table.nodes.table.streamArn],
    },
  ],
});

table.subscribe("NoteReceivedOutbox", outbox.arn, {
  // Only inserts reach the lambda; the RAW# prefix is checked in code, since prefix filters
  // on a DynamoDB stream key are not reliably applied.
  filters: [{ eventName: ["INSERT"] }],
});
