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
    const { api } = await import("./infra/api");
    const { ingest } = await import("./infra/ingest");

    return {
      api: api.url,
      webhook: $interpolate`${api.url}/webhooks/kapso`,
      ingestFunction: ingest.name,
    };
  },
});
