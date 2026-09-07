import { hmacHex } from "@watcher/core";

const url = process.argv[2] ?? process.env.WEBHOOK_URL;
const secret = process.argv[3] ?? process.env.KAPSO_WEBHOOK_SECRET;

if (url === undefined || secret === undefined) {
  console.error("usage: bun run webhook:test <url> <secret>");
  process.exit(1);
}

const payload = {
  message: {
    id: `wamid.test-${Date.now()}`,
    timestamp: String(Math.floor(Date.now() / 1000)),
    type: "text",
    from: "16315551181",
    text: { body: "Hello from send-test-webhook" },
    kapso: { direction: "inbound", status: "received", has_media: false },
  },
  conversation: { id: "conv_test", phone_number: "16315551181" },
  phone_number_id: "123456789012345",
};

const body = JSON.stringify(payload);

const response = await fetch(url, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-webhook-signature": hmacHex(secret, body),
  },
  body,
});

console.log(response.status, await response.text());
process.exit(response.ok ? 0 : 1);
