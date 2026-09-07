import { api } from "./api";
import {
  alarmDispatchDlq,
  alarmDispatchQueue,
  noteProcessingDlq,
  noteProcessingQueue,
} from "./events";
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

function alarm(name: string, args: Omit<aws.cloudwatch.MetricAlarmArgs, "name">) {
  return new aws.cloudwatch.MetricAlarm(name, {
    // Silence while nothing has happened yet; only real data raises an alarm.
    treatMissingData: "notBreaching",
    alarmActions: [opsAlerts.arn],
    okActions: [opsAlerts.arn],
    ...args,
  });
}

const lambdas = [
  { key: "Ingest", fn: ingest, timeoutMs: 20_000 },
  { key: "Outbox", fn: outbox, timeoutMs: 30_000 },
  { key: "Processor", fn: processor, timeoutMs: 30_000 },
  { key: "Notifier", fn: notifier, timeoutMs: 30_000 },
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
