import { JsonLogger, type LogFields } from "@watcher/core";
import { describe, expect, it } from "bun:test";
import { KapsoWhatsAppSender } from "../src/repositories/kapso-whatsapp.sender.js";

interface Call {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
}

function build(response: { status: number; payload?: unknown } | Error) {
  const lines: LogFields[] = [];
  const calls: Call[] = [];
  const logger = new JsonLogger({ service: "notifier" }, (line) => {
    lines.push(JSON.parse(line) as LogFields);
  });

  const fetchImpl = (async (url: string, init: RequestInit) => {
    if (response instanceof Error) {
      throw response;
    }

    calls.push({
      url: String(url),
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    });

    return new Response(JSON.stringify(response.payload ?? {}), { status: response.status });
  }) as unknown as typeof globalThis.fetch;

  const sender = new KapsoWhatsAppSender(
    { apiUrl: "https://api.kapso.example", apiKey: "test-key", phoneNumberId: "597907523413541" },
    logger,
    fetchImpl,
  );

  return { sender, calls, lines };
}

const message = { to: "+51999000001", body: "Anotado ✅ Llamar al proveedor." };

describe("KapsoWhatsAppSender", () => {
  it("posts the message to the phone number's endpoint", async () => {
    const { sender, calls, lines } = build({
      status: 200,
      payload: { messages: [{ id: "wamid.out.1" }] },
    });

    await sender.send(message);

    expect(calls[0]?.url).toBe(
      "https://api.kapso.example/meta/whatsapp/v24.0/597907523413541/messages",
    );
    expect(calls[0]?.headers["x-api-key"]).toBe("test-key");
    expect(calls[0]?.body).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "51999000001",
      type: "text",
      text: { body: message.body },
    });
    expect(lines.find((line) => line.event === "whatsapp_message_sent")?.messageId).toBe(
      "wamid.out.1",
    );
  });

  it("strips the leading plus, which WhatsApp does not take", async () => {
    const { sender, calls } = build({ status: 200 });

    await sender.send(message);

    expect(calls[0]?.body.to).toBe("51999000001");
  });

  it("recognises a closed 24 hour window and does not retry it", async () => {
    const { sender } = build({
      status: 400,
      payload: { error: { code: 131047, message: "Message failed to send" } },
    });

    const error = await sender.send(message).catch((e) => e);

    expect(error.code).toBe("outside_customer_service_window");
    expect(error.retryable).toBe(false);
  });

  it("does not retry a rejected key or a malformed send", async () => {
    for (const status of [400, 401, 403]) {
      const { sender } = build({ status, payload: { error: { message: "nope" } } });

      const error = await sender.send(message).catch((e) => e);

      expect(error.retryable).toBe(false);
    }
  });

  it("retries a rate limit or an outage", async () => {
    for (const status of [429, 500, 503]) {
      const { sender } = build({ status });

      const error = await sender.send(message).catch((e) => e);

      expect(error.retryable).toBe(true);
    }
  });

  it("retries when the request never reached KAPSO", async () => {
    const { sender } = build(new Error("socket hang up"));

    const error = await sender.send(message).catch((e) => e);

    expect(error.code).toBe("whatsapp_unavailable");
    expect(error.retryable).toBe(true);
  });
});
