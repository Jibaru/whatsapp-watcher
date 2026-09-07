/// <reference path="./.sst/platform/config.d.ts" />

const PROFILE_BY_STAGE: Record<string, string> = {
  production: "iamadmin-production",
};

const DEFAULT_PROFILE = "iamadmin-general";

export default $config({
  app(input) {
    const stage = input?.stage ?? "dev";
    const isProduction = stage === "production";

    return {
      name: "whatsapp-watcher",
      removal: isProduction ? "retain" : "remove",
      protect: isProduction,
      home: "aws",
      providers: {
        aws: {
          region: "us-east-1",
          profile: PROFILE_BY_STAGE[stage] ?? DEFAULT_PROFILE,
        },
      },
    };
  },

  async run() {
    // Se define con: bun run secret:set
    const kapsoWebhookSecret = new sst.Secret("KapsoWebhookSecret");

    const api = new sst.aws.ApiGatewayV2("WatcherApi", {
      accessLog: { retention: "2 weeks" },
    });

    const ingest = new sst.aws.Function("IngestFunction", {
      handler: "src/main.handler",
      runtime: "nodejs24.x",
      memory: "512 MB",
      // Holgado a propósito: aquí entrará la descarga del media (ver docs/ENUNCIADO.md §5.1).
      timeout: "20 seconds",
      logging: { retention: "2 weeks" },
      environment: {
        APP_STAGE: $app.stage,
        KAPSO_WEBHOOK_SECRET: kapsoWebhookSecret.value,
      },
    });

    api.route("POST /webhooks/kapso", ingest.arn);
    api.route("GET /health", ingest.arn);

    return {
      api: api.url,
      webhook: $interpolate`${api.url}/webhooks/kapso`,
      ingestFunction: ingest.name,
    };
  },
});
