import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function hashIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function safeCompare(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");

  if (left.length !== right.length) {
    // Compare against itself so the length difference does not leak through timing.
    timingSafeEqual(left, left);
    return false;
  }

  return timingSafeEqual(left, right);
}

export function hmacHex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}
