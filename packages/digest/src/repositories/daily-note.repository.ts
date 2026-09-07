import { QueryCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { dayKeysBetween, NOTE_DAY_PREFIX, type Logger } from "@watcher/core";
import type { DigestNote } from "../domain/daily-digest.js";

export interface DailyNoteRepository {
  findCreatedBetween(from: Date, to: Date): Promise<DigestNote[]>;
}

const PAGE_LIMIT = 200;

export class DynamoDailyNoteRepository implements DailyNoteRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly timeZone: string,
    private readonly logger: Logger,
  ) {}

  /**
   * One query per local day the window touches, which for 24 hours is two at most. The
   * alternative, a single partition holding every note ever written, would make the digest pay
   * for the whole history to read one day of it.
   */
  async findCreatedBetween(from: Date, to: Date): Promise<DigestNote[]> {
    const fromEpoch = Math.floor(from.getTime() / 1000);
    const toEpoch = Math.floor(to.getTime() / 1000);
    const found: DigestNote[] = [];

    for (const day of dayKeysBetween(from, to, this.timeZone)) {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: "NoteDigestIndex",
          KeyConditionExpression: "gsi2pk = :day AND gsi2sk BETWEEN :from AND :to",
          ExpressionAttributeValues: {
            ":day": `${NOTE_DAY_PREFIX}${day}`,
            ":from": fromEpoch,
            ":to": toEpoch,
          },
          Limit: PAGE_LIMIT,
        }),
      );

      if (result.LastEvaluatedKey !== undefined) {
        // Said out loud rather than paged: a day past the limit is a different problem from a
        // quiet one, and the summary should not pretend it saw everything.
        this.logger.warn("digest_day_truncated", { day, limit: PAGE_LIMIT });
      }

      for (const item of result.Items ?? []) {
        found.push({
          noteId: String(item.noteId),
          title: String(item.title ?? ""),
          summary: String(item.summary ?? ""),
          priority: String(item.priority ?? "normal"),
          createdAt: new Date(Number(item.createdAtEpoch) * 1000),
          dueAt: item.dueAtEpoch === undefined ? undefined : new Date(Number(item.dueAtEpoch) * 1000),
        });
      }
    }

    return found.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
}
