import { describe, expect, it } from "bun:test";
import { ModelOutputInvalidError } from "../src/domain/errors.js";
import { toAnalyzerError } from "../src/repositories/openai-note-analyzer.js";

function httpError(name: string, statusCode: number): Error {
  return Object.assign(new Error(name), { name, statusCode });
}

describe("toAnalyzerError", () => {
  it("retries a rate limit", () => {
    const error = toAnalyzerError(httpError("APICallError", 429));

    expect(error.retryable).toBe(true);
  });

  it("retries a gateway hiccup", () => {
    for (const status of [500, 502, 503]) {
      const error = toAnalyzerError(httpError("APICallError", status));

      expect(error.retryable).toBe(true);
    }
  });

  it("does not retry a rejected key or a malformed request", () => {
    for (const status of [400, 401, 403, 404, 413, 422]) {
      const error = toAnalyzerError(httpError("APICallError", status));

      expect(error.retryable).toBe(false);
      expect(error.code).toBe("model_rejected");
    }
  });

  it("does not retry an answer that did not match the schema", () => {
    const error = toAnalyzerError(httpError("NoObjectGeneratedError", 200));

    expect(error.retryable).toBe(false);
    expect(error.code).toBe("model_output_invalid");
  });

  it("keeps a domain error it already produced", () => {
    const original = new ModelOutputInvalidError("no title");

    expect(toAnalyzerError(original)).toBe(original);
  });

  it("retries anything it cannot classify", () => {
    const error = toAnalyzerError(new Error("socket hang up"));

    expect(error.retryable).toBe(true);
  });

  it("keeps the original cause so the log says what really happened", () => {
    const cause = httpError("APICallError", 401);
    const error = toAnalyzerError(cause);

    expect(error.cause).toBe(cause);
  });
});
