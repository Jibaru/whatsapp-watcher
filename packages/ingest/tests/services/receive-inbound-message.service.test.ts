import { describe, expect, it } from "bun:test";
import { ReceiveInboundMessageService } from "../../src/services/receive-inbound-message.service.js";
import { FakeInboundMessageRepository, MemoryLogger } from "../support/fakes.js";

const receivedAt = new Date("2026-09-06T10:00:00.000Z");

function build(options: { logRawPayload?: boolean; duplicate?: boolean } = {}) {
  const logger = new MemoryLogger();
  const repository = new FakeInboundMessageRepository({
    stored: !options.duplicate,
    duplicate: options.duplicate ?? false,
  });
  const service = new ReceiveInboundMessageService(repository, logger, {
    logRawPayload: options.logRawPayload ?? false,
    newId: () => "generated-id",
  });

  return { service, repository, logger };
}

describe("ReceiveInboundMessageService", () => {
  it("turns the input DTO into a domain model and saves it", async () => {
    const { service, repository } = build();

    const output = await service.execute({
      messageId: "wamid-1",
      from: "+51999888777",
      kind: "audio",
      mediaUrl: "https://kapso.example/media/1.ogg",
      mediaMimeType: "audio/ogg",
      receivedAt,
      rawPayload: { id: "wamid-1" },
    });

    expect(output).toEqual({
      messageId: "wamid-1",
      duplicate: false,
      generatedMessageId: false,
    });
    expect(repository.saved).toHaveLength(1);
    expect(repository.saved[0]?.kind).toBe("audio");
    expect(repository.saved[0]?.hasMedia()).toBe(true);
  });

  it("generates an id and warns when the payload carries none", async () => {
    const { service, logger, repository } = build();

    const output = await service.execute({
      from: "+51999888777",
      kind: "text",
      receivedAt,
      rawPayload: {},
    });

    expect(output.messageId).toBe("generated-id");
    expect(output.generatedMessageId).toBe(true);
    expect(repository.saved).toHaveLength(1);
    expect(logger.events()).toContain("kapso_payload_incomplete");
  });

  it("normalizes any unrecognized kind to unknown", async () => {
    const { service, repository } = build();

    await service.execute({
      messageId: "wamid-2",
      from: "+51999888777",
      kind: "sticker",
      receivedAt,
      rawPayload: {},
    });

    expect(repository.saved[0]?.kind).toBe("unknown");
  });

  it("propagates the duplicate flag reported by the repository", async () => {
    const { service } = build({ duplicate: true });

    const output = await service.execute({
      messageId: "wamid-1",
      from: "+51999888777",
      receivedAt,
      rawPayload: {},
    });

    expect(output.duplicate).toBe(true);
  });

  it("dumps the raw payload only when enabled", async () => {
    const enabled = build({ logRawPayload: true });
    const disabled = build({ logRawPayload: false });
    const input = {
      messageId: "wamid-1",
      from: "+51999888777",
      receivedAt,
      rawPayload: { secret: "must not reach production logs" },
    };

    await enabled.service.execute(input);
    await disabled.service.execute(input);

    expect(enabled.logger.events()).toContain("kapso_webhook_raw_payload");
    expect(disabled.logger.events()).not.toContain("kapso_webhook_raw_payload");
  });
});
