# WhatsApp Watcher

A WhatsApp notetaker. You send a message to a WhatsApp number — text, a photo or a voice note —
and it is filed as a structured note. Writing one gets no answer: you hear back at the hour you
asked for, and once a day by email with everything that was captured.

Notes, their raw events and their media are kept forever. Nothing expires.

```
Usuario ──▶ KAPSO ──▶ API Gateway ──▶ ingest ──▶ S3 (media)
                                          └────▶ DynamoDB
                                                    │ stream         ▲
                                                    ▼                │
                                                 outbox ──▶ EventBridge ──▶ SQS ──▶ processor ──▶ OpenAI
                                                                                        │
                                                            EventBridge Scheduler ◀─────┘ (only if it has an hour)
                                                                     │
                                          Usuario ◀── KAPSO ◀── notifier ◀── SQS
                                                                                                   
                            cron 24 h ──▶ digest ──▶ DynamoDB ──▶ SNS ──▶ correo
```

Full design in [`docs/ENUNCIADO.md`](docs/ENUNCIADO.md) (Spanish). Interactive diagrams:
[ingest and processing](docs/arquitectura.html), [delivery and observability](docs/arquitectura-salida.html).

## How it works

1. **ingest** verifies the KAPSO HMAC signature before parsing the body, downloads the media into S3
   and writes one item to DynamoDB. That write is its only one, and the idempotency key: the same
   `messageId` twice produces a single note.
2. **outbox** reads the DynamoDB stream and publishes `note.received`. Deriving the event from
   committed state is what makes it impossible to store a note and never announce it.
3. **processor** reads the item, pulls the media from S3, transcribes audio and extracts the note
   through OpenAI, and writes it. If the note asked for an hour it also schedules the reminder.
   If it did not, nothing else happens: that is the whole point.
4. **notifier** sends the reminder on the same WhatsApp thread when EventBridge Scheduler drops it on
   the queue. Outside production it only writes to numbers on an allowlist; an empty allowlist sends
   to nobody.
5. **digest** runs once every 24 hours, asks DynamoDB what was written and what is due next, and
   emails the summary through SNS. On a day with nothing to report it sends nothing, and says so
   through a metric instead.

Every step is at-least-once, so every consumer is idempotent and errors are classified as retryable
or not: a transient one goes back to the queue and ends in a DLQ, a permanent one is acknowledged
instead of burning three attempts to reach the same place.

## Layout

This is a monorepo of Bun workspaces, one module per lambda:

```
packages/core/       shared kernel: logger, tracing, errors, event contracts
packages/ingest/     KAPSO webhook
packages/outbox/     DynamoDB stream to EventBridge
packages/processor/  OpenAI analysis
packages/notifier/   WhatsApp delivery
packages/evaluator/  five minute sweep for reminders the scheduler missed
packages/digest/     daily summary by email
infra/               one file per lambda, imported from sst.config.ts
integration/         tests against the deployed dev stage, one file per behaviour
docs/                design document and diagrams
```

Inside a lambda the shape is always the same: `handler` owns HTTP and the provider's format,
`service` takes an input DTO and returns an output DTO around domain classes, and `repository`
hides whether the data lives in DynamoDB, S3, EventBridge or a log line.

## Running it

```bash
bun install
bun test packages          # unit tests, no network
bun run typecheck
```

Deploying needs two secrets and an AWS profile (`iamadmin-general` for dev, in `us-east-1`):

```bash
bun run secret:set         # KAPSO webhook secret, from its dashboard
bun run secret:openai      # OpenAI API key
bun run secret:kapso-api   # KAPSO API key, from Project Settings > API Keys
bun run secret:phone-id    # the phone_number_id the webhook payload carries
bun run allowlist:set      # your own number in E.164 while testing
bun run ops-emails:set     # comma separated addresses for the alarms
bun run deploy             # sst deploy --stage dev
bun run test:integration   # runs against the deployed stage, about six minutes
```

A secret with no value stops the deploy rather than shipping a lambda that cannot work.

`bun run dev` starts `sst dev`, which deploys the real API Gateway but runs the lambdas on your
machine, so logs land in your terminal and changes apply without redeploying.

To exercise the webhook without WhatsApp, this posts a correctly signed payload anywhere:

```bash
bun run webhook:test <url> <secret>
```

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `OPENAI_MODEL_ID` | `gpt-4.1-mini` | Model that extracts the note. `gpt-5*` needs a verified organization. |
| `OPENAI_TRANSCRIPTION_MODEL_ID` | `whisper-1` | Model that transcribes voice notes. |
| `DEFAULT_TIMEZONE` | `America/Lima` | Resolves "tomorrow at ten" into an instant. |
| `MEDIA_MAX_BYTES` | 16 MiB | Larger media is dropped and the note kept. |
| `ALLOWED_RECIPIENTS` | empty | Comma separated. Outside production, nothing is sent to anyone else. |
| `DIGEST_WINDOW_HOURS` | 24 | How far back the daily summary looks. |
| `DIGEST_LOOKAHEAD_HOURS` | 24 | How far ahead it lists what is still due. |

## Watching it

`whatsapp-watcher-<stage>` in CloudWatch Dashboards holds the whole pipeline on one page, and its
last widget lists every alarm. That widget is worth knowing about: an alarm reads OK both when it is
healthy and when it has never seen a datapoint, and side by side the difference is obvious.

Two SNS topics carry email, both subscribed to the addresses in `OpsEmails`: `ops-alerts` for the
alarms and `daily-digest` for the summary. Each address confirms each subscription separately, which
is what lets someone drop the summary without losing the alarms.

## Known gaps

- A reminder that fires more than 24 hours after the user last wrote cannot be delivered. Meta only
  allows free-form text inside that window; reopening it needs a template it has approved, and KAPSO
  does not allow templates on a sandbox number. So there is no fallback to build in dev, and the one
  that existed was removed rather than left pretending to cover the case. The reminder is marked
  `UNDELIVERABLE` with its reason, taken out of the index and counted as `reminders_undeliverable`,
  which is a different state from `EXPIRED`: one means nobody wanted it any more, the other means
  somebody did and WhatsApp would not carry it. Production, on a real number with an approved utility
  template, is where that path comes back.
- Rule based alarms (silence for N days, urgency) are not built. Evaluating rules before there is any
  way to create one would be a machine with no input. The one rule worth having, the periodic
  summary, is the `digest` lambda and needs no rules to exist.
- The digest goes to the ops addresses, not to the user's WhatsApp, and its hour is the same for the
  whole stage. Both are fine for one user and would not be for many.
- Replies always go to the full international number. A national one lets WhatsApp fill in the
  country of the sending account, which once delivered a note to a stranger in another country, so
  the sandbox test number must be registered with its country code.
- Nothing consumes `note.failed` yet. The raw item is marked FAILED, the event is published and the
  NotesDropped alarm fires, but the user is never told their note could not be processed.
- Note content leaves AWS: text, images and audio are sent to OpenAI. Swapping that for a model
  inside the account means one new `NoteAnalyzer` implementation.
