import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { Logger } from "@watcher/core";
import {
  MediaTooLargeError,
  type InboundMediaRepository,
  type StoreMediaCommand,
  type StoredMedia,
} from "./inbound-media.repository.js";

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "audio/ogg": ".ogg",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "video/mp4": ".mp4",
  "application/pdf": ".pdf",
};

export class S3InboundMediaRepository implements InboundMediaRepository {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly maxBytes: number,
    private readonly logger: Logger,
  ) {}

  async store(command: StoreMediaCommand): Promise<StoredMedia> {
    if (command.declaredSizeBytes !== undefined && command.declaredSizeBytes > this.maxBytes) {
      throw new MediaTooLargeError(command.declaredSizeBytes, this.maxBytes);
    }

    const response = await fetch(command.sourceUrl);

    if (!response.ok) {
      throw new Error(`Media download failed with ${response.status}`);
    }

    const body = new Uint8Array(await response.arrayBuffer());

    // The declared size comes from the webhook and can lie; this one cannot.
    if (body.byteLength > this.maxBytes) {
      throw new MediaTooLargeError(body.byteLength, this.maxBytes);
    }

    const contentType =
      command.contentType ?? response.headers.get("content-type") ?? "application/octet-stream";
    const key = mediaKey(command.messageId, contentType);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );

    this.logger.info("media_stored", { key, sizeBytes: body.byteLength, contentType });

    return { key, sizeBytes: body.byteLength, contentType };
  }
}

/**
 * A wamid is base64, so it can carry "/" and "+" that would nest or confuse the key.
 * Sanitizing keeps the id readable in the console, which matters when tracing an object
 * back to its message.
 */
export function mediaKey(messageId: string, contentType?: string): string {
  const safeId = messageId.replace(/[^A-Za-z0-9._-]/g, "_");
  const extension = contentType === undefined ? "" : (EXTENSION_BY_TYPE[contentType] ?? "");

  return `inbound/${safeId}${extension}`;
}
