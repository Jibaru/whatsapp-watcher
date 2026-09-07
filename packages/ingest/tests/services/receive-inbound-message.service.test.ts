import { describe, expect, it } from "bun:test";
import { ReceiveInboundMessageService } from "../../src/services/receive-inbound-message.service.js";
import {
  CallLog,
  FakeInboundMediaRepository,
  FakeInboundMessageRepository,
  MemoryLogger,
} from "../support/fakes.js";

const receivedAt = new Date("2026-09-06T10:00:00.000Z");

function build(
  options: { logRawPayload?: boolean; duplicate?: boolean; media?: { tooLarge?: boolean; fails?: boolean } } = {},
) {
  const logger = new MemoryLogger();
  const callLog = new CallLog();
  const repository = new FakeInboundMessageRepository(
    { stored: !options.duplicate, duplicate: options.duplicate ?? false },
    callLog,
  );
  const mediaRepository = new FakeInboundMediaRepository(options.media ?? {}, callLog);
  const service = new ReceiveInboundMessageService(repository, mediaRepository, logger, {
    logRawPayload: options.logRawPayload ?? false,
    newId: () => "generated-id",
  });

  return { service, repository, mediaRepository, logger, callLog };
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

  it("stores the media before writing the message", async () => {
    const { service, repository, mediaRepository, callLog } = build();

    await service.execute({
      messageId: "wamid-1",
      from: "+51999888777",
      kind: "image",
      mediaUrl: "https://kapso.example/media/1.jpg",
      mediaMimeType: "image/jpeg",
      mediaSizeBytes: 75681,
      receivedAt,
      rawPayload: {},
    });

    expect(callLog.calls).toEqual(["store", "save"]);
    expect(mediaRepository.stored[0]).toMatchObject({
      sourceUrl: "https://kapso.example/media/1.jpg",
      messageId: "wamid-1",
      declaredSizeBytes: 75681,
    });
    expect(repository.saved[0]?.media?.key).toBe("inbound/wamid-1.jpg");
  });

  it("keeps the note without its file when the media is too large", async () => {
    const { service, repository, logger } = build({ media: { tooLarge: true } });

    await service.execute({
      messageId: "wamid-1",
      from: "+51999888777",
      text: "caption",
      mediaUrl: "https://kapso.example/huge.mp4",
      receivedAt,
      rawPayload: {},
    });

    expect(repository.saved).toHaveLength(1);
    expect(repository.saved[0]?.hasMedia()).toBe(false);
    expect(repository.saved[0]?.text).toBe("caption");
    expect(logger.events()).toContain("media_too_large");
  });

  it("does not write the message when the download fails, so KAPSO retries", async () => {
    const { service, repository } = build({ media: { fails: true } });

    await expect(
      service.execute({
        messageId: "wamid-1",
        from: "+51999888777",
        mediaUrl: "https://kapso.example/1.jpg",
        receivedAt,
        rawPayload: {},
      }),
    ).rejects.toThrow(/download failed/);
    expect(repository.saved).toHaveLength(0);
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
