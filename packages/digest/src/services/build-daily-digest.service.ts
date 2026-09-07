import type { Logger, Metrics } from "@watcher/core";
import { DailyDigest } from "../domain/daily-digest.js";
import type { DailyNoteRepository } from "../repositories/daily-note.repository.js";
import type { DigestPublisher } from "../repositories/digest.publisher.js";
import type { UpcomingReminderRepository } from "../repositories/upcoming-reminder.repository.js";

export interface BuildDailyDigestOutput {
  readonly notes: number;
  readonly reminders: number;
  readonly sent: boolean;
}

export interface BuildDailyDigestOptions {
  readonly stage: string;
  readonly timeZone: string;
  readonly windowHours: number;
  readonly lookaheadHours: number;
  readonly now?: () => Date;
}

const HOUR_MS = 60 * 60 * 1000;

export class BuildDailyDigestService {
  private readonly now: () => Date;

  constructor(
    private readonly notes: DailyNoteRepository,
    private readonly reminders: UpcomingReminderRepository,
    private readonly publisher: DigestPublisher,
    private readonly logger: Logger,
    private readonly metrics: Metrics,
    private readonly options: BuildDailyDigestOptions,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Polling, not events: nobody pushes the summary here. It asks DynamoDB what happened, which
   * means the summary can be rebuilt at any time and a missed run loses nothing.
   */
  async execute(): Promise<BuildDailyDigestOutput> {
    const to = this.now();
    const from = new Date(to.getTime() - this.options.windowHours * HOUR_MS);
    const lookahead = new Date(to.getTime() + this.options.lookaheadHours * HOUR_MS);

    const notes = await this.notes.findCreatedBetween(from, to);
    const reminders = await this.reminders.findDueBetween(to, lookahead);

    // Counted before deciding whether to send: this is what proves the cron is still alive,
    // and a quiet day must not look like a dead one.
    this.metrics.count("digest_runs");
    this.metrics.value("digest_notes", notes.length, "Count");

    const digest = DailyDigest.create({
      stage: this.options.stage,
      timeZone: this.options.timeZone,
      from,
      to,
      notes,
      reminders,
    });

    if (digest.isEmpty()) {
      // A daily email saying nothing happened is noise, and noise takes the signal with it.
      this.logger.info("digest_empty", { from: from.toISOString(), to: to.toISOString() });

      return { notes: 0, reminders: 0, sent: false };
    }

    await this.publisher.publish(digest.subject(), digest.body());
    this.metrics.count("digest_sent");

    this.logger.info("digest_sent", { notes: notes.length, reminders: reminders.length });

    return { notes: notes.length, reminders: reminders.length, sent: true };
  }
}
