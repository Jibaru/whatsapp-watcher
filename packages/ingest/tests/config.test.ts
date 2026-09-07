import { describe, expect, it } from "bun:test";
import { loadIngestConfig } from "../src/config.js";

describe("loadIngestConfig", () => {
  it("strips whitespace pasted around the secret", () => {
    const config = loadIngestConfig({
      APP_STAGE: "dev",
      KAPSO_WEBHOOK_SECRET: "60e4a1\r",
    });

    expect(config.kapsoWebhookSecret).toBe("60e4a1");
  });

  it("throws on a cold start when the secret is missing or blank", () => {
    expect(() => loadIngestConfig({ APP_STAGE: "dev" })).toThrow(/KAPSO_WEBHOOK_SECRET/);
    expect(() => loadIngestConfig({ APP_STAGE: "dev", KAPSO_WEBHOOK_SECRET: "  " })).toThrow(
      /KAPSO_WEBHOOK_SECRET/,
    );
  });

  it("flags production so the raw payload dump stays off there", () => {
    const dev = loadIngestConfig({ APP_STAGE: "dev", KAPSO_WEBHOOK_SECRET: "s" });
    const prod = loadIngestConfig({ APP_STAGE: "production", KAPSO_WEBHOOK_SECRET: "s" });

    expect(dev.isProduction).toBe(false);
    expect(prod.isProduction).toBe(true);
  });
});
