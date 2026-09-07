import { describe, expect, it } from "bun:test";
import { createApp } from "../../src/app.js";
import type { IngestConfig } from "../../src/config.js";
import { ReceiveInboundMessageService } from "../../src/services/receive-inbound-message.service.js";
import { FakeInboundMessageRepository, MemoryLogger } from "../support/fakes.js";

const config: IngestConfig = {
  stage: "test",
  isProduction: false,
  kapsoWebhookSecret: "test-secret",
  kapsoSecretHeader: "x-kapso-webhook-secret",
};

function build() {
  const logger = new MemoryLogger();
  const repository = new FakeInboundMessageRepository();
  const receiveInboundMessage = new ReceiveInboundMessageService(repository, logger, {
    logRawPayload: false,
    newId: () => "generated-id",
  });

  return { app: createApp({ config, logger, receiveInboundMessage }), repository, logger };
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/webhooks/kapso", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const authorized = { "x-kapso-webhook-secret": "test-secret" };

describe("ingest api", () => {
  it("answers the health check with the stage", async () => {
    const { app } = build();

    const response = await app.request("/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", stage: "test" });
  });

  it("rejects the webhook without the secret header and processes nothing", async () => {
    const { app, repository, logger } = build();

    const response = await app.request(post({ id: "wamid-1" }));

    expect(response.status).toBe(401);
    expect(repository.saved).toHaveLength(0);
    expect(logger.events()).toContain("webhook_unauthorized");
  });

  it("rejects the webhook with a wrong secret", async () => {
    const { app, repository } = build();

    const response = await app.request(post({ id: "wamid-1" }, { "x-kapso-webhook-secret": "nope" }));

    expect(response.status).toBe(401);
    expect(repository.saved).toHaveLength(0);
  });

  it("accepts a valid message and returns its id", async () => {
    const { app, repository } = build();

    const response = await app.request(
      post({ id: "wamid-1", from: "+51999888777", type: "text", text: "hola" }, authorized),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "accepted",
      messageId: "wamid-1",
      duplicate: false,
    });
    expect(repository.saved).toHaveLength(1);
  });

  it("accepts unknown fields while the KAPSO format is unconfirmed", async () => {
    const { app, repository } = build();

    const response = await app.request(
      post({ id: "wamid-2", from: "+51999888777", unexpected_field: { nested: true } }, authorized),
    );

    expect(response.status).toBe(200);
    expect(repository.saved).toHaveLength(1);
  });

  it("returns 400 when a known field has the wrong type", async () => {
    const { app, repository } = build();

    const response = await app.request(post({ id: 123 }, authorized));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_payload" });
    expect(repository.saved).toHaveLength(0);
  });
});
