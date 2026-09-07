import { createHash, timingSafeEqual } from "node:crypto";

/** Identificador estable y no reversible para logs: el teléfono nunca va en claro. */
export function hashIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/** Comparación en tiempo constante, tolerante a longitudes distintas. */
export function safeCompare(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");

  if (left.length !== right.length) {
    // Se compara igualmente contra sí mismo para no filtrar la longitud por tiempo.
    timingSafeEqual(left, left);
    return false;
  }

  return timingSafeEqual(left, right);
}
