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
    const { bus, noteProcessingQueue, alarmDispatchQueue } = await import("./infra/events");
    const { ingest } = await import("./infra/ingest");
    const { outbox } = await import("./infra/outbox");
    const { processor } = await import("./infra/processor");
    const { notifier } = await import("./infra/notifier");

    return {
      api: api.url,
      webhook: $interpolate`${api.url}/webhooks/kapso`,
      ingestFunction: ingest.name,
      outboxFunction: outbox.name,
      processorFunction: processor.name,
      notifierFunction: notifier.name,
      bus: bus.name,
      queue: noteProcessingQueue.url,
      dispatchQueue: alarmDispatchQueue.url,
    };
  },
});
