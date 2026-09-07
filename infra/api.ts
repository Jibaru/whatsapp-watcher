export const api = new sst.aws.ApiGatewayV2("WatcherApi", {
  accessLog: { retention: "2 weeks" },
});
