import { describe, expect, it } from "bun:test";
import { JsonLogger, type LogFields } from "../src/logger.js";
import { getLogContext, runWithLogContext, setLogContext } from "../src/log-context.js";

function collect() {
  const lines: LogFields[] = [];
  const logger = new JsonLogger({ service: "test" }, (line) => {
    lines.push(JSON.parse(line) as LogFields);
  });

  return { logger, lines };
}

describe("log context", () => {
  it("stamps every line inside the scope", () => {
    const { logger, lines } = collect();

    runWithLogContext({ correlationId: "corr-1" }, () => {
      logger.info("first");
      logger.child({ layer: "repository" }).info("second");
    });

    expect(lines.map((line) => line.correlationId)).toEqual(["corr-1", "corr-1"]);
    expect(lines[1]?.layer).toBe("repository");
  });

  it("keeps ids discovered later, across await boundaries", async () => {
    const { logger, lines } = collect();

    await runWithLogContext({ correlationId: "corr-2" }, async () => {
      await Promise.resolve();
      setLogContext({ conversationId: "conv-9", messageId: "wamid.1" });
      await Promise.resolve();
      logger.info("after");
    });

    expect(lines[0]).toMatchObject({
      correlationId: "corr-2",
      conversationId: "conv-9",
      messageId: "wamid.1",
    });
  });

  it("does not leak between concurrent scopes", async () => {
    const { logger, lines } = collect();

    await Promise.all([
      runWithLogContext({ correlationId: "a" }, async () => {
        await Promise.resolve();
        logger.info("from-a");
      }),
      runWithLogContext({ correlationId: "b" }, async () => {
        logger.info("from-b");
      }),
    ]);

    expect(lines.find((line) => line.event === "from-a")?.correlationId).toBe("a");
    expect(lines.find((line) => line.event === "from-b")?.correlationId).toBe("b");
  });

  it("is inert outside any scope", () => {
    const { logger, lines } = collect();

    setLogContext({ conversationId: "ignored" });
    logger.info("orphan");

    expect(getLogContext()).toBeUndefined();
    expect(lines[0]?.correlationId).toBeUndefined();
    expect(lines[0]?.event).toBe("orphan");
  });
});
