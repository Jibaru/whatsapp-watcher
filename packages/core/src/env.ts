/**
 * Trims on the way out: a secret pasted on Windows easily carries a trailing \r, and an
 * invisible byte inside an HMAC key turns every signature check into a 401.
 */
export function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();

  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}
