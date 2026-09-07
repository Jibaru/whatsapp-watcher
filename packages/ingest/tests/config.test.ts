import { describe, expect, it } from "bun:test";
import { loadIngestConfig } from "../src/config.js";

const required = {
  APP_STAGE: "dev",
  KAPSO_WEBHOOK_SECRET: "secret",
  MEDIA_BUCKET: "bucket",
  TABLE_NAME: "table",
};

describe("loadIngestConfig", () => {
  it("strips whitespace pasted around the secret", () => {
    const config = loadIngestConfig({
      ...required,
      KAPSO_WEBHOOK_SECRET: "60e4a1\r",
    });

    expect(config.kapsoWebhookSecret).toBe("60e4a1");
  });

  it("throws on a cold start when the secret is missing or blank", () => {
    expect(() => loadIngestConfig({ ...required, KAPSO_WEBHOOK_SECRET: undefined })).toThrow(
      /KAPSO_WEBHOOK_SECRET/,
    );
    expect(() => loadIngestConfig({ ...required, KAPSO_WEBHOOK_SECRET: "  " })).toThrow(
      /KAPSO_WEBHOOK_SECRET/,
    );
    expect(() => loadIngestConfig({ ...required, MEDIA_BUCKET: undefined })).toThrow(
      /MEDIA_BUCKET/,
    );
  });

  it("flags production so the raw payload dump stays off there", () => {
    const dev = loadIngestConfig(required);
    const prod = loadIngestConfig({ ...required, APP_STAGE: "production" });

    expect(dev.isProduction).toBe(false);
    expect(prod.isProduction).toBe(true);
  });
});
