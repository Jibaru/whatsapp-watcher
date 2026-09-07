import { randomUUID } from "node:crypto";
import { runWithLogContext } from "@watcher/core";
import { createMiddleware } from "hono/factory";

const CORRELATION_HEADER = "x-correlation-id";

interface LambdaBindings {
  lambdaContext?: { awsRequestId?: string };
}

/**
 * Opens the log context for the whole request. Prefers an inbound correlation id, then the
 * AWS request id, so a CloudWatch line can always be tied back to its invocation.
 */
export function withLogContext() {
  return createMiddleware(async (c, next) => {
    const inherited = c.req.header(CORRELATION_HEADER);
    const awsRequestId = (c.env as LambdaBindings | undefined)?.lambdaContext?.awsRequestId;
    const correlationId = inherited ?? awsRequestId ?? randomUUID();

    c.header(CORRELATION_HEADER, correlationId);

    await runWithLogContext({ correlationId }, next);
  });
}
