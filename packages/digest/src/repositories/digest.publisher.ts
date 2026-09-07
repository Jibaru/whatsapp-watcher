import { PublishCommand, type SNSClient } from "@aws-sdk/client-sns";
import { TransientError, type Logger } from "@watcher/core";

export interface DigestPublisher {
  publish(subject: string, body: string): Promise<void>;
}

export class SnsDigestPublisher implements DigestPublisher {
  constructor(
    private readonly client: SNSClient,
    private readonly topicArn: string,
    private readonly logger: Logger,
  ) {}

  async publish(subject: string, body: string): Promise<void> {
    try {
      const result = await this.client.send(
        new PublishCommand({ TopicArn: this.topicArn, Subject: subject, Message: body }),
      );

      this.logger.info("digest_published", { snsMessageId: result.MessageId });
    } catch (error) {
      // Nothing is queued behind this: the next run rebuilds the summary from DynamoDB, so a
      // failure here is worth retrying rather than swallowing.
      throw new TransientError("digest_publish_failed", "SNS rejected the daily digest", {
        cause: error,
      });
    }
  }
}
