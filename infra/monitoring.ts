import { api } from "./api";
import {
  alarmDispatchDlq,
  alarmDispatchQueue,
  noteProcessingDlq,
  noteProcessingQueue,
} from "./events";
import { evaluator } from "./evaluator";
import { ingest } from "./ingest";
import { notifier } from "./notifier";
import { outbox } from "./outbox";
import { processor } from "./processor";
import { table } from "./storage";

/** Comma separated. One topic, one subscription per address: that is the fan-out. */
export const opsEmails = new sst.Secret("OpsEmails");

export const opsAlerts = new sst.aws.SnsTopic("OpsAlerts");

// SST only subscribes lambdas, and these have to reach people. The list arrives as an Output,
// so the subscriptions are created inside apply: they do not show up in preview, only on deploy.
opsEmails.value.apply((raw) => {
  const addresses = raw
    .split(",")
    .map((address) => address.trim())
    .filter((address) => address !== "");

  for (const address of addresses) {
    // Named after the address so adding or removing one does not churn the others.
    const slug = address.replace(/[^a-zA-Z0-9]/g, "-");

    new aws.sns.TopicSubscription(`OpsAlertsEmail-${slug}`, {
      topic: opsAlerts.arn,
      protocol: "email",
      endpoint: address,
    });
  }
});

const isProduction = $app.stage === "production";
const NAMESPACE = "WhatsAppWatcher";
const businessDimensions = (service: string) => ({ stage: $app.stage, service });

const created: aws.cloudwatch.MetricAlarm[] = [];

function alarm(name: string, args: Omit<aws.cloudwatch.MetricAlarmArgs, "name">) {
  const metricAlarm = new aws.cloudwatch.MetricAlarm(name, {
    // Silence while nothing has happened yet; only real data raises an alarm.
    treatMissingData: "notBreaching",
    alarmActions: [opsAlerts.arn],
    okActions: [opsAlerts.arn],
    ...args,
  });

  created.push(metricAlarm);

  return metricAlarm;
}

const lambdas = [
  { key: "Ingest", fn: ingest, timeoutMs: 20_000 },
  { key: "Outbox", fn: outbox, timeoutMs: 30_000 },
  { key: "Processor", fn: processor, timeoutMs: 30_000 },
  { key: "Notifier", fn: notifier, timeoutMs: 30_000 },
  { key: "Evaluator", fn: evaluator, timeoutMs: 60_000 },
];

// 1. A note ran out of attempts. The one alarm that always means work was lost.
for (const [key, queue] of [
  ["NoteProcessing", noteProcessingDlq],
  ["AlarmDispatch", alarmDispatchDlq],
] as const) {
  alarm(`DlqNotEmpty${key}`, {
    alarmDescription: `${key} DLQ has messages: something exhausted its retries`,
    namespace: "AWS/SQS",
    metricName: "ApproximateNumberOfMessagesVisible",
    dimensions: { QueueName: queue.nodes.queue.name },
    statistic: "Maximum",
    period: 300,
    evaluationPeriods: 1,
    threshold: 0,
    comparisonOperator: "GreaterThanThreshold",
  });
}

// 2. Work is piling up: the consumer is down or cannot keep up.
for (const [key, queue] of [
  ["NoteProcessing", noteProcessingQueue],
  ["AlarmDispatch", alarmDispatchQueue],
] as const) {
  alarm(`QueueBacklogStale${key}`, {
    alarmDescription: `${key} has a message older than 15 minutes`,
    namespace: "AWS/SQS",
    metricName: "ApproximateAgeOfOldestMessage",
    dimensions: { QueueName: queue.nodes.queue.name },
    statistic: "Maximum",
    period: 300,
    evaluationPeriods: 1,
    threshold: 900,
    comparisonOperator: "GreaterThanThreshold",
  });
}

for (const { key, fn, timeoutMs } of lambdas) {
  // 3. Unhandled failures. Production tolerates a couple before waking anyone.
  alarm(`LambdaErrors${key}`, {
    alarmDescription: `${key} is throwing`,
    namespace: "AWS/Lambda",
    metricName: "Errors",
    dimensions: { FunctionName: fn.name },
    statistic: "Sum",
    period: 300,
    evaluationPeriods: 1,
    threshold: isProduction ? 3 : 1,
    comparisonOperator: "GreaterThanOrEqualToThreshold",
  });

  // 4. Concurrency ran out: invocations are being rejected before running.
  alarm(`LambdaThrottles${key}`, {
    alarmDescription: `${key} is being throttled`,
    namespace: "AWS/Lambda",
    metricName: "Throttles",
    dimensions: { FunctionName: fn.name },
    statistic: "Sum",
    period: 300,
    evaluationPeriods: 1,
    threshold: 1,
    comparisonOperator: "GreaterThanOrEqualToThreshold",
  });

  // 5. Close to the timeout, where the next slow call starts failing.
  alarm(`LambdaDurationP95${key}`, {
    alarmDescription: `${key} p95 duration is above 80% of its timeout`,
    namespace: "AWS/Lambda",
    metricName: "Duration",
    dimensions: { FunctionName: fn.name },
    extendedStatistic: "p95",
    period: 300,
    evaluationPeriods: 2,
    threshold: timeoutMs * 0.8,
    comparisonOperator: "GreaterThanThreshold",
  });
}

// 6. KAPSO is getting errors from us; its retries will run out.
alarm("ApiGateway5xx", {
  alarmDescription: "The webhook is answering 5xx",
  namespace: "AWS/ApiGateway",
  metricName: "5xx",
  dimensions: { ApiId: api.nodes.api.id },
  statistic: "Sum",
  period: 300,
  evaluationPeriods: 1,
  threshold: 1,
  comparisonOperator: "GreaterThanOrEqualToThreshold",
});

// 7. The webhook is slow enough that the caller may give up on us.
alarm("ApiGatewayLatencyP99", {
  alarmDescription: "The webhook p99 latency is above 3 seconds",
  namespace: "AWS/ApiGateway",
  metricName: "Latency",
  dimensions: { ApiId: api.nodes.api.id },
  extendedStatistic: "p99",
  period: 300,
  evaluationPeriods: 2,
  threshold: 3000,
  comparisonOperator: "GreaterThanThreshold",
});

// 8. Writes are being rejected.
alarm("DynamoThrottled", {
  alarmDescription: "DynamoDB is throttling requests",
  namespace: "AWS/DynamoDB",
  metricName: "ThrottledRequests",
  dimensions: { TableName: table.name },
  statistic: "Sum",
  period: 300,
  evaluationPeriods: 1,
  threshold: 1,
  comparisonOperator: "GreaterThanOrEqualToThreshold",
});

// 9. The model is refusing us: a rejected key, a bad model id, or an outage.
alarm("ModelInvocationErrors", {
  alarmDescription: "The model rejected or failed several calls in a row",
  namespace: NAMESPACE,
  metricName: "model_errors",
  dimensions: businessDimensions("processor"),
  statistic: "Sum",
  period: 900,
  evaluationPeriods: 1,
  threshold: 3,
  comparisonOperator: "GreaterThanOrEqualToThreshold",
});

// 10. Silence is the failure mode nothing else catches: the webhook could be unregistered
// and every other metric would stay flat and green.
if (isProduction) {
  alarm("NoNotesIngested", {
    alarmDescription: "No message has arrived in 24 hours: the webhook is probably broken",
    namespace: NAMESPACE,
    metricName: "notes_ingested",
    dimensions: businessDimensions("ingest"),
    statistic: "Sum",
    period: 86_400,
    evaluationPeriods: 1,
    threshold: 1,
    comparisonOperator: "LessThanThreshold",
    // Here missing data IS the alarm.
    treatMissingData: "breaching",
  });
}

// 10b. Closes the blind spot: a permanent error is acknowledged on purpose, so it never
// reaches a DLQ and no queue based alarm can see the note that was dropped.
alarm("NotesDropped", {
  alarmDescription: "A note was discarded by a permanent error and will not be retried",
  namespace: NAMESPACE,
  metricName: "notes_dropped",
  dimensions: businessDimensions("processor"),
  statistic: "Sum",
  period: 900,
  evaluationPeriods: 1,
  threshold: 1,
  comparisonOperator: "GreaterThanOrEqualToThreshold",
});

// 10c. The sweep is a safety net: if it keeps finding work, the scheduler is failing.
alarm("RemindersSwept", {
  alarmDescription: "The sweep had to rescue reminders the scheduler did not deliver",
  namespace: NAMESPACE,
  metricName: "reminders_swept",
  dimensions: businessDimensions("evaluator"),
  statistic: "Sum",
  period: 900,
  evaluationPeriods: 1,
  threshold: 1,
  comparisonOperator: "GreaterThanOrEqualToThreshold",
});

// 11. Notes are being produced but not reaching the user.
alarm("AlarmsNotDelivered", {
  alarmDescription: "More than 10% of the notifications failed in the last hour",
  comparisonOperator: "GreaterThanThreshold",
  evaluationPeriods: 1,
  threshold: 10,
  metricQueries: [
    {
      id: "failureRate",
      expression: "IF(attempted > 0, 100 * failed / attempted, 0)",
      label: "Failed notifications (%)",
      returnData: true,
    },
    {
      id: "failed",
      metric: {
        namespace: NAMESPACE,
        metricName: "alarms_failed",
        dimensions: businessDimensions("notifier"),
        stat: "Sum",
        period: 3600,
      },
    },
    {
      id: "attempted",
      metric: {
        namespace: NAMESPACE,
        metricName: "alarms_attempted",
        dimensions: businessDimensions("notifier"),
        stat: "Sum",
        period: 3600,
      },
    },
  ],
});

// 12. The notes still flow, but the model stopped understanding them.
alarm("LowModelConfidence", {
  alarmDescription: "Average model confidence below 0.5: the prompt or the model degraded",
  namespace: NAMESPACE,
  metricName: "model_confidence",
  dimensions: businessDimensions("processor"),
  statistic: "Average",
  period: 3600,
  evaluationPeriods: 1,
  threshold: 0.5,
  comparisonOperator: "LessThanThreshold",
});

/**
 * The alarms answer whether something is broken; this answers what the system is doing. It is
 * where you look after being woken, and where a slow degradation shows before any threshold.
 */
const dashboardBody = $resolve({
  region: aws.getRegionOutput().name,
  apiId: api.nodes.api.id,
  queue: noteProcessingQueue.nodes.queue.name,
  queueDlq: noteProcessingDlq.nodes.queue.name,
  dispatch: alarmDispatchQueue.nodes.queue.name,
  dispatchDlq: alarmDispatchDlq.nodes.queue.name,
  ingestName: ingest.name,
  outboxName: outbox.name,
  processorName: processor.name,
  notifierName: notifier.name,
  evaluatorName: evaluator.name,
  alarmArns: $resolve(created.map((metricAlarm) => metricAlarm.arn)),
}).apply((ids) => {
  const stage = $app.stage;
  const business = (metricName: string, service: string, label: string, stat = "Sum") => [
    NAMESPACE,
    metricName,
    "stage",
    stage,
    "service",
    service,
    { label, stat },
  ];
  const queueDepth = (name: string, label: string) => [
    "AWS/SQS",
    "ApproximateNumberOfMessagesVisible",
    "QueueName",
    name,
    { label, stat: "Maximum" },
  ];
  const lambdaErrors = (name: string, label: string) => [
    "AWS/Lambda",
    "Errors",
    "FunctionName",
    name,
    { label, stat: "Sum" },
  ];

  const metric = (
    x: number,
    y: number,
    width: number,
    title: string,
    metrics: unknown[][],
    extra: Record<string, unknown> = {},
  ) => ({
    type: "metric",
    x,
    y,
    width,
    height: 6,
    properties: {
      title,
      region: ids.region,
      view: "timeSeries",
      stacked: false,
      period: 300,
      metrics,
      ...extra,
    },
  });

  return JSON.stringify({
    widgets: [
      metric(0, 0, 8, "Webhook", [
        ["AWS/ApiGateway", "Count", "ApiId", ids.apiId, { label: "peticiones", stat: "Sum" }],
        ["AWS/ApiGateway", "5xx", "ApiId", ids.apiId, { label: "5xx", stat: "Sum" }],
        ["AWS/ApiGateway", "4xx", "ApiId", ids.apiId, { label: "4xx", stat: "Sum" }],
      ]),
      metric(
        8,
        0,
        8,
        "Latencia del webhook",
        [["AWS/ApiGateway", "Latency", "ApiId", ids.apiId, { label: "p99", stat: "p99" }]],
        { yAxis: { left: { label: "ms", showUnits: false } } },
      ),
      metric(16, 0, 8, "Notas entrantes", [
        business("notes_ingested", "ingest", "recibidas"),
        business("notes_processed", "processor", "procesadas"),
      ]),

      metric(0, 6, 12, "Profundidad de colas", [
        queueDepth(ids.queue, "note-processing"),
        queueDepth(ids.dispatch, "alarm-dispatch"),
        queueDepth(ids.queueDlq, "DLQ note-processing"),
        queueDepth(ids.dispatchDlq, "DLQ alarm-dispatch"),
      ]),
      metric(
        12,
        6,
        12,
        "Antigüedad del mensaje más viejo",
        [
          [
            "AWS/SQS",
            "ApproximateAgeOfOldestMessage",
            "QueueName",
            ids.queue,
            { label: "note-processing", stat: "Maximum" },
          ],
          [
            "AWS/SQS",
            "ApproximateAgeOfOldestMessage",
            "QueueName",
            ids.dispatch,
            { label: "alarm-dispatch", stat: "Maximum" },
          ],
        ],
        { annotations: { horizontal: [{ label: "umbral de alarma", value: 900 }] } },
      ),

      metric(0, 12, 8, "Recordatorios rescatados", [
        business("notes_dropped", "processor", "notas descartadas"),
        business("reminders_swept", "evaluator", "rescatados por el barrido"),
        business("reminders_expired", "evaluator", "expirados"),
      ]),
      metric(
        8,
        12,
        8,
        "Latencia del modelo",
        [
          business("model_latency_ms", "processor", "media", "Average"),
          business("model_latency_ms", "processor", "p95", "p95"),
        ],
        { yAxis: { left: { label: "ms", showUnits: false } } },
      ),
      metric(
        16,
        12,
        8,
        "Calidad del modelo",
        [
          business("model_errors", "processor", "errores"),
          business("model_confidence", "processor", "confianza media", "Average"),
        ],
        { annotations: { horizontal: [{ label: "confianza mínima", value: 0.5 }] } },
      ),

      metric(0, 18, 12, "Avisos al usuario", [
        business("alarms_attempted", "notifier", "intentados"),
        business("alarms_sent", "notifier", "enviados"),
        business("alarms_failed", "notifier", "fallidos"),
      ]),
      metric(12, 18, 12, "Errores por lambda", [
        lambdaErrors(ids.ingestName, "ingest"),
        lambdaErrors(ids.outboxName, "outbox"),
        lambdaErrors(ids.processorName, "processor"),
        lambdaErrors(ids.notifierName, "notifier"),
        lambdaErrors(ids.evaluatorName, "evaluator"),
      ]),

      {
        type: "alarm",
        x: 0,
        y: 24,
        width: 24,
        height: 8,
        properties: {
          // Side by side it is obvious which alarms are OK with data and which never saw a
          // datapoint, a difference the console hides when you look at them one by one.
          title: "Estado de las alarmas",
          alarms: ids.alarmArns,
          sortBy: "stateUpdatedTimestamp",
        },
      },
    ],
  });
});

export const dashboard = new aws.cloudwatch.Dashboard("WatcherDashboard", {
  dashboardName: `whatsapp-watcher-${$app.stage}`,
  dashboardBody,
});
