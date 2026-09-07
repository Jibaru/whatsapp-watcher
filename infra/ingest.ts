import { api } from "./api";
import { mediaBucket, table } from "./storage";

export const kapsoWebhookSecret = new sst.Secret("KapsoWebhookSecret");

export const ingest = new sst.aws.Function("IngestFunction", {
  handler: "packages/ingest/src/main.handler",
  runtime: "nodejs24.x",
  memory: "512 MB",
  // Roomy on purpose: this downloads the media before answering (docs/ENUNCIADO.md, 5.1).
  timeout: "20 seconds",
  logging: { retention: "2 weeks" },
  link: [mediaBucket, table],
  environment: {
    APP_STAGE: $app.stage,
    KAPSO_WEBHOOK_SECRET: kapsoWebhookSecret.value,
    MEDIA_BUCKET: mediaBucket.name,
    TABLE_NAME: table.name,
  },
});

api.route("POST /webhooks/kapso", ingest.arn);
api.route("GET /health", ingest.arn);
