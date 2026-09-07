import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";

export interface StoredMedia {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

export interface MediaReader {
  read(key: string, fallbackMimeType?: string): Promise<StoredMedia>;
}

export class S3MediaReader implements MediaReader {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async read(key: string, fallbackMimeType?: string): Promise<StoredMedia> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );

    const bytes = await response.Body!.transformToByteArray();

    return {
      bytes,
      contentType: response.ContentType ?? fallbackMimeType ?? "application/octet-stream",
    };
  }
}
