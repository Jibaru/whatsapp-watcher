/** Comma separated. One subscription per address on each topic: that is the fan-out. */
export const opsEmails = new sst.Secret("OpsEmails");

/**
 * SST only subscribes lambdas, and these have to reach people. The list arrives as an Output,
 * so the subscriptions are created inside apply: they do not show up in preview, only on deploy.
 */
export function subscribeEmails(name: string, topic: sst.aws.SnsTopic): void {
  opsEmails.value.apply((raw) => {
    const addresses = raw
      .split(",")
      .map((address) => address.trim())
      .filter((address) => address !== "");

    for (const address of addresses) {
      // Named after the address so adding or removing one does not churn the others.
      const slug = address.replace(/[^a-zA-Z0-9]/g, "-");

      new aws.sns.TopicSubscription(`${name}-${slug}`, {
        topic: topic.arn,
        protocol: "email",
        endpoint: address,
      });
    }
  });
}
