import { hmacHex } from "@watcher/core";
import { describe, expect, it } from "bun:test";
import { createApp } from "../../src/app.js";
import type { IngestConfig } from "../../src/config.js";
import { ReceiveInboundMessageService } from "../../src/services/receive-inbound-message.service.js";
import { FakeInboundMessageRepository, MemoryLogger } from "../support/fakes.js";

const config: IngestConfig = {
  stage: "test",
  isProduction: false,
  kapsoWebhookSecret: "test-secret",
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

function inboundMessage(overrides: Record<string, unknown> = {}) {
  return {
    message: {
      id: "wamid.123",
      timestamp: "1730092800",
      type: "text",
      from: "16315551181",
      text: { body: "Hello" },
      kapso: { direction: "inbound", status: "received", has_media: false, content: "Hello" },
      ...overrides,
    },
    conversation: { id: "conv_123", phone_number: "16315551181" },
    phone_number_id: "123456789012345",
  };
}

function post(payload: unknown, options: { signature?: string | null } = {}) {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { "content-type": "application/json" };
  const signature =
    options.signature === undefined ? hmacHex(config.kapsoWebhookSecret, body) : options.signature;

  if (signature !== null) {
    headers["x-webhook-signature"] = signature;
  }

  return new Request("http://localhost/webhooks/kapso", { method: "POST", headers, body });
}

describe("ingest api", () => {
  it("answers the health check with the stage", async () => {
    const { app } = build();

    const response = await app.request("/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", stage: "test" });
  });

  it("rejects the webhook without a signature and processes nothing", async () => {
    const { app, repository, logger } = build();

    const response = await app.request(post({ id: "wamid-1" }, { signature: null }));

    expect(response.status).toBe(401);
    expect(repository.saved).toHaveLength(0);
    expect(logger.events()).toContain("webhook_unauthorized");
  });

  it("rejects a signature computed with another secret", async () => {
    const { app, repository } = build();
    const body = { id: "wamid-1" };

    const response = await app.request(
      post(body, { signature: hmacHex("another-secret", JSON.stringify(body)) }),
    );

    expect(response.status).toBe(401);
    expect(repository.saved).toHaveLength(0);
  });

  it("rejects a valid signature that belongs to a different body", async () => {
    const { app, repository } = build();

    const response = await app.request(
      post(
        { id: "wamid-1", text: "tampered" },
        { signature: hmacHex(config.kapsoWebhookSecret, JSON.stringify({ id: "wamid-1" })) },
      ),
    );

    expect(response.status).toBe(401);
    expect(repository.saved).toHaveLength(0);
  });

  it("accepts a correctly signed message and returns its id", async () => {
    const { app, repository } = build();

    const response = await app.request(post(inboundMessage()));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "accepted",
      messageId: "wamid.123",
      duplicate: false,
    });
    expect(repository.saved[0]?.from).toBe("16315551181");
    expect(repository.saved[0]?.text).toBe("Hello");
  });

  it("reads the media url out of the kapso envelope", async () => {
    const { app, repository } = build();

    await app.request(
      post(
        inboundMessage({
          type: "audio",
          text: undefined,
          kapso: { has_media: true, media_url: "https://kapso.example/media/1.ogg" },
        }),
      ),
    );

    expect(repository.saved[0]?.kind).toBe("audio");
    expect(repository.saved[0]?.media?.url).toBe("https://kapso.example/media/1.ogg");
  });

  it("accepts unknown fields: the payload carries more than we map", async () => {
    const { app, repository } = build();

    const response = await app.request(
      post({ ...inboundMessage(), is_new_conversation: true, unexpected_field: { nested: true } }),
    );

    expect(response.status).toBe(200);
    expect(repository.saved).toHaveLength(1);
  });

  it("returns 400 when a known field has the wrong type", async () => {
    const { app, repository } = build();

    const response = await app.request(post({ message: { id: 123 } }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_payload" });
    expect(repository.saved).toHaveLength(0);
  });
});
