export const mediaBucket = new sst.aws.Bucket("MediaBucket");

// No GSIs yet: the entities that need them (notes, alarms) do not exist, and DynamoDB
// adds indexes online later. No TTL either, by design (docs/ENUNCIADO.md, 7).
export const table = new sst.aws.Dynamo("WatcherTable", {
  fields: { pk: "string", sk: "string" },
  primaryIndex: { hashKey: "pk", rangeKey: "sk" },
  stream: "new-and-old-images",
});
