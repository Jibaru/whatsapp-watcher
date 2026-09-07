/**
 * Configuración fail-closed: si falta algo, la Lambda revienta en el arranque en frío
 * en lugar de arrancar sin poder verificar el webhook.
 */
export interface AppConfig {
  readonly stage: string;
  readonly isProduction: boolean;
  readonly kapsoWebhookSecret: string;
  /** Cabecera donde KAPSO manda el secreto compartido. En minúsculas. */
  readonly kapsoSecretHeader: string;
}

const DEFAULT_SECRET_HEADER = "x-kapso-webhook-secret";

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const stage = requireEnv(env, "APP_STAGE");

  return {
    stage,
    isProduction: stage === "production",
    kapsoWebhookSecret: requireEnv(env, "KAPSO_WEBHOOK_SECRET"),
    kapsoSecretHeader: (env.KAPSO_SECRET_HEADER ?? DEFAULT_SECRET_HEADER).toLowerCase(),
  };
}

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];

  if (value === undefined || value.trim() === "") {
    throw new Error(`Falta la variable de entorno obligatoria: ${key}`);
  }

  return value;
}
