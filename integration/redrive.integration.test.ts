import {
  GetQueueAttributesCommand,
  type QueueAttributeName,
  ListMessageMoveTasksCommand,
  SendMessageCommand,
  SQSClient,
  StartMessageMoveTaskCommand,
} from "@aws-sdk/client-sqs";
import { NOTE_RECEIVED, WATCHER_EVENT_SOURCE } from "@watcher/core";
import { afterAll, describe, expect, it } from "bun:test";
import { Resource } from "sst";
import {
  cleanUp,
  itemsWithPrefix,
  newMessageId,
  sendWebhook,
  sleep,
  TEST_PARTITION,
  waitForItem,
} from "./support/watcher.js";

const sqs = new SQSClient({});
const created: string[] = [];

afterAll(async () => {
  await Promise.all(created.map((id) => cleanUp(id)));
});

async function attribute(queueUrl: string, name: QueueAttributeName): Promise<string> {
  const result = await sqs.send(
    new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: [name] }),
  );

  return result.Attributes![name]!;
}

describe("redrive against dev", () => {
  it(
    "reprocesses what fell into the DLQ without duplicating the note",
    async () => {
      const id = newMessageId("redrive");
      created.push(id);

      await sendWebhook(id, { text: "comprar pan mañana" });

      const first = await waitForItem(`NOTE#${id}`);

      expect(first?.noteId).toBeDefined();

      const dlqUrl = Resource.NoteProcessingDlq.url;

      await sqs.send(
        new SendMessageCommand({
          QueueUrl: dlqUrl,
          MessageBody: JSON.stringify({
            source: WATCHER_EVENT_SOURCE,
            "detail-type": NOTE_RECEIVED,
            detail: {
              correlationId: `redrive-${Date.now()}`,
              messageId: id,
              pk: TEST_PARTITION,
              sk: `RAW#${id}`,
              from: "+51999000001",
              kind: "text",
              hasMedia: false,
              receivedAt: new Date().toISOString(),
            },
          }),
        }),
      );

      // The move task photographs the queue when it starts, so a message that just landed
      // can be left out and the task still reports COMPLETED with nothing moved.
      await sleep(45_000);

      const dlqArn = await attribute(dlqUrl, "QueueArn");
      const mainArn = await attribute(Resource.NoteProcessingQueue.url, "QueueArn");

      // The destination is explicit because SQS can only infer it for messages it moved
      // itself; one put there by hand fails with CouldNotDetermineMessageSource.
      await sqs.send(
        new StartMessageMoveTaskCommand({ SourceArn: dlqArn, DestinationArn: mainArn }),
      );

      let moved = 0;

      for (let attempt = 0; attempt < 15; attempt++) {
        await sleep(5000);

        const [task] =
          (await sqs.send(new ListMessageMoveTasksCommand({ SourceArn: dlqArn, MaxResults: 1 })))
            .Results ?? [];

        if (task?.Status !== "RUNNING") {
          moved = task?.ApproximateNumberOfMessagesMoved ?? 0;
          expect(task?.Status).toBe("COMPLETED");
          break;
        }
      }

      expect(moved).toBeGreaterThan(0);

      // Reprocessing mints a new noteId, which is how we know it actually ran again.
      const second = await waitForItem(`NOTE#${id}`, (item) => item.noteId !== first?.noteId);

      expect(second?.noteId).not.toBe(first?.noteId);

      const notes = (await itemsWithPrefix(`NOTE#${id}`)).length;

      // The key is NOTE#messageId, so a second run overwrites instead of duplicating.
      expect(notes).toBe(1);
    },
    420_000,
  );
});
