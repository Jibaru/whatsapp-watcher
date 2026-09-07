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

function build(options: { logRawPayload?: boolean } = {}) {
  const logger = new MemoryLogger();
  const repository = new FakeInboundMessageRepository();
  const receiveInboundMessage = new ReceiveInboundMessageService(repository, logger, {
    logRawPayload: options.logRawPayload ?? false,
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

const imageMessage = {
  message: {
    id: "wamid.HBgTUEUuMTYx",
    type: "image",
    from: "982705024",
    from_user_id: "PE.1618166519838886",
    kapso: {
      has_media: true,
      media_url: "https://app.kapso.example/blobs/image_1a1f.jpeg",
      content: "buenas Image attached (image_1a1f.jpeg) [Size: 73.9 KB | Type: image/jpeg] URL: ...",
      media_data: {
        url: "https://app.kapso.example/blobs/image_1a1f.jpeg",
        filename: "image_1a1f.jpeg",
        byte_size: 75681,
        content_type: "image/jpeg",
      },
      message_type_data: { caption: "buenas", has_media: true },
    },
    image: { id: "2819309705107520", caption: "buenas", mime_type: "image/jpeg" },
    timestamp: "1788747742",
  },
  conversation: { id: "d41530b9", phone_number: "982705024", contact_name: "x" },
  phone_number_id: "597907523413541",
  is_new_conversation: false,
};

function post(
  payload: unknown,
  options: { signature?: string | null; correlationId?: string } = {},
) {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { "content-type": "application/json" };

  if (options.correlationId !== undefined) {
    headers["x-correlation-id"] = options.correlationId;
  }
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

  it("takes the caption as text on media messages, not the synthesized summary", async () => {
    const { app, repository } = build();

    await app.request(post(imageMessage));
    const saved = repository.saved[0];

    expect(saved?.kind).toBe("image");
    expect(saved?.text).toBe("buenas");
    expect(saved?.media?.url).toBe("https://app.kapso.example/blobs/image_1a1f.jpeg");
    expect(saved?.media?.mimeType).toBe("image/jpeg");
    expect(saved?.media?.sizeBytes).toBe(75681);
  });

  it("normalizes the sender to E.164 using the country in from_user_id", async () => {
    const { app, repository } = build();

    await app.request(post(imageMessage));

    expect(repository.saved[0]?.from).toBe("+51982705024");
    expect(repository.saved[0]?.fromIsE164).toBe(true);
    expect(repository.saved[0]?.fromCountry).toBe("PE");
  });

  it("falls back to the conversation phone and its country hint", async () => {
    const { app, repository } = build();

    await app.request(
      post({
        message: { id: "wamid.1" },
        conversation: { phone_number: "982705024", business_scoped_user_id: "PE.161816651983" },
      }),
    );

    expect(repository.saved[0]?.from).toBe("+51982705024");
  });

  it("keeps the raw number and warns when it cannot be normalized", async () => {
    const { app, repository, logger } = build();

    await app.request(post({ message: { id: "wamid.2", from: "982705024" } }));

    expect(repository.saved[0]?.from).toBe("982705024");
    expect(repository.saved[0]?.fromIsE164).toBe(false);
    expect(logger.events()).toContain("phone_not_normalized");
  });

  it("stamps every log line of the request with the same correlation id", async () => {
    const { app, logger } = build({ logRawPayload: true });

    const response = await app.request(post(imageMessage));
    const correlationId = response.headers.get("x-correlation-id");

    expect(correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(logger.entries.length).toBeGreaterThan(1);
    for (const entry of logger.entries) {
      expect(entry.correlationId).toBe(correlationId);
    }
  });

  it("carries the conversation and message ids into the persistence log", async () => {
    const { app, logger } = build();

    await app.request(post(imageMessage));

    expect(logger.find("inbound_message_received")).toMatchObject({
      conversationId: "d41530b9",
      messageId: "wamid.HBgTUEUuMTYx",
    });
  });

  it("reuses an inbound correlation id instead of minting a new one", async () => {
    const { app, logger } = build();

    const response = await app.request(post(imageMessage, { correlationId: "trace-from-caller" }));

    expect(response.headers.get("x-correlation-id")).toBe("trace-from-caller");
    expect(logger.find("inbound_message_received")?.correlationId).toBe("trace-from-caller");
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
