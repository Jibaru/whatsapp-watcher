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

bus.subscribeQueue("NoteProcessed", alarmDispatchQueue, {
  pattern: { source: ["watcher.processor"], detailType: ["note.processed"] },
});
