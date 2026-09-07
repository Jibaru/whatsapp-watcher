export const mediaBucket = new sst.aws.Bucket("MediaBucket");

// No TTL, by design (docs/ENUNCIADO.md, 7).
export const table = new sst.aws.Dynamo("WatcherTable", {
  fields: { pk: "string", sk: "string", gsi1pk: "string", gsi1sk: "number" },
  primaryIndex: { hashKey: "pk", rangeKey: "sk" },
  // Lets the evaluator ask "which reminders are due and still pending" without a scan.
  globalIndexes: { AlarmDueIndex: { hashKey: "gsi1pk", rangeKey: "gsi1sk" } },
  stream: "new-and-old-images",
});
