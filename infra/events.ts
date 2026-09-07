export const bus = new sst.aws.Bus("WatcherBus");

export const noteProcessingDlq = new sst.aws.Queue("NoteProcessingDlq");

export const noteProcessingQueue = new sst.aws.Queue("NoteProcessingQueue", {
  // Six times the processor timeout, so a slow retry never gets redelivered mid-flight.
  visibilityTimeout: "3 minutes",
  dlq: { queue: noteProcessingDlq.arn, retry: 3 },
});

bus.subscribeQueue("NoteReceived", noteProcessingQueue, {
  pattern: { source: ["watcher.ingest"], detailType: ["note.received"] },
});

export const alarmDispatchDlq = new sst.aws.Queue("AlarmDispatchDlq");

export const alarmDispatchQueue = new sst.aws.Queue("AlarmDispatchQueue", {
  visibilityTimeout: "3 minutes",
  dlq: { queue: alarmDispatchDlq.arn, retry: 3 },
});

// No bus rule feeds this queue: its only producers are EventBridge Scheduler when a reminder
// comes due and the evaluator when the scheduler did not deliver.

/** EventBridge Scheduler needs its own identity to drop the reminder on the queue. */
export const schedulerRole = new aws.iam.Role("ReminderSchedulerRole", {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: "scheduler.amazonaws.com" }),
});

new aws.iam.RolePolicy("ReminderSchedulerPolicy", {
  role: schedulerRole.id,
  policy: alarmDispatchQueue.arn.apply((arn) =>
    JSON.stringify({
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Action: ["sqs:SendMessage"], Resource: arn }],
    }),
  ),
});
