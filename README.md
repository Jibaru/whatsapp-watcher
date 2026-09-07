# WhatsApp Watcher

A WhatsApp notetaker. You send a message to a WhatsApp number — text, a photo or a voice note —
and it comes back as a structured note with a reminder you get on the same thread.

Notes, their raw events and their media are kept forever. Nothing expires.

```
Usuario ──▶ KAPSO ──▶ API Gateway ──▶ ingest ──▶ S3 (media)
                                          └────▶ DynamoDB
                                                    │ stream
                                                    ▼
                                                 outbox ──▶ EventBridge ──▶ SQS ──▶ processor ──▶ OpenAI
                                                                                        │
                                          notifier ◀── SQS ◀── EventBridge ◀────────────┘
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
   through OpenAI, writes it and publishes `note.processed`.
4. **notifier** answers on the same WhatsApp thread, both the confirmation and, later, the reminder
   that EventBridge Scheduler drops on the same queue. Outside production it only writes to numbers on
   an allowlist; an empty allowlist sends to nobody.

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
infra/               one file per lambda, imported from sst.config.ts
integration/         tests against the deployed dev stage
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
bun run test:integration   # runs against the deployed stage
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

## Known gaps

- A reminder that fires more than 24 hours after the user last wrote needs an approved template.
  The code path is there and tested: on Meta's code 131047 the sender retries the same reminder as
  a template with a single body variable. It stays inactive until `KapsoReminderTemplate` names an
  approved template, so today a next-day reminder still fails.
- Rule based alarms (silence for N days, a daily digest of overdue notes) need the evaluator and the
  AlarmDueIndex GSI. The reminder items already carry the index attributes.
- Replies always go to the full international number. A national one lets WhatsApp fill in the
  country of the sending account, which once delivered a note to a stranger in another country, so
  the sandbox test number must be registered with its country code.
- Nothing consumes `note.failed` yet. The raw item is marked FAILED, the event is published and the
  NotesDropped alarm fires, but the user is never told their note could not be processed.
- Note content leaves AWS: text, images and audio are sent to OpenAI. Swapping that for a model
  inside the account means one new `NoteAnalyzer` implementation.
