export const mediaBucket = new sst.aws.Bucket("MediaBucket");

// No TTL, by design (docs/ENUNCIADO.md, 7).
export const table = new sst.aws.Dynamo("WatcherTable", {
  fields: {
    pk: "string",
    sk: "string",
    gsi1pk: "string",
    gsi1sk: "number",
    gsi2pk: "string",
    gsi2sk: "number",
  },
  primaryIndex: { hashKey: "pk", rangeKey: "sk" },
  globalIndexes: {
    // Lets the evaluator ask "which reminders are due and still pending" without a scan.
    AlarmDueIndex: { hashKey: "gsi1pk", rangeKey: "gsi1sk" },
    // And the digest ask "what was written on this day", one local day per partition.
    NoteDigestIndex: { hashKey: "gsi2pk", rangeKey: "gsi2sk" },
  },
  stream: "new-and-old-images",
});
