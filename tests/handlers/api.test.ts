import { describe, expect, it } from "bun:test";
import { createApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config/env.js";
import { ReceiveInboundMessageService } from "../../src/services/receive-inbound-message.service.js";
import { FakeInboundMessageRepository, MemoryLogger } from "../support/fakes.js";

const config: AppConfig = {
  stage: "test",
  isProduction: false,
  kapsoWebhookSecret: "secreto-de-prueba",
  kapsoSecretHeader: "x-kapso-webhook-secret",
};

function build() {
  const logger = new MemoryLogger();
  const repository = new FakeInboundMessageRepository();
  const receiveInboundMessage = new ReceiveInboundMessageService(repository, logger, {
    logRawPayload: false,
    newId: () => "generated-id",
  });

  return { app: createApp({ config, logger, receiveInboundMessage }), repository, logger };
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/webhooks/kapso", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const authorized = { "x-kapso-webhook-secret": "secreto-de-prueba" };

describe("API de ingesta", () => {
  it("responde al health check con el stage", async () => {
    const { app } = build();

    const response = await app.request("/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", stage: "test" });
  });

  it("rechaza el webhook sin cabecera de secreto y no procesa nada", async () => {
    const { app, repository, logger } = build();

    const response = await app.request(post({ id: "wamid-1" }));

    expect(response.status).toBe(401);
    expect(repository.saved).toHaveLength(0);
    expect(logger.events()).toContain("webhook_unauthorized");
  });

  it("rechaza el webhook con un secreto incorrecto", async () => {
    const { app, repository } = build();

    const response = await app.request(
      post({ id: "wamid-1" }, { "x-kapso-webhook-secret": "otro" }),
    );

    expect(response.status).toBe(401);
    expect(repository.saved).toHaveLength(0);
  });

  it("acepta un mensaje válido y devuelve su id", async () => {
    const { app, repository } = build();

    const response = await app.request(
      post({ id: "wamid-1", from: "+51999888777", type: "text", text: "hola" }, authorized),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "accepted",
      messageId: "wamid-1",
      duplicate: false,
    });
    expect(repository.saved).toHaveLength(1);
  });

  it("acepta campos desconocidos: el formato de KAPSO todavía no está cerrado", async () => {
    const { app, repository } = build();

    const response = await app.request(
      post({ id: "wamid-2", from: "+51999888777", campo_inesperado: { anidado: true } }, authorized),
    );

    expect(response.status).toBe(200);
    expect(repository.saved).toHaveLength(1);
  });

  it("devuelve 400 cuando un campo conocido tiene el tipo equivocado", async () => {
    const { app, repository } = build();

    const response = await app.request(post({ id: 123 }, authorized));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_payload" });
    expect(repository.saved).toHaveLength(0);
  });
});
