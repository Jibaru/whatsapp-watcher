import { createRoute, z, type RouteHandler } from "@hono/zod-openapi";
import type { ReceiveInboundMessageService } from "../services/receive-inbound-message.service.js";

/**
 * Provisional: the real KAPSO payload is unconfirmed, so every field is optional and
 * unknown ones pass through. Tighten it once CloudWatch shows the first real message.
 */
export const KapsoWebhookBodySchema = z
  .looseObject({
    id: z.string().optional(),
    type: z.string().optional(),
    from: z.string().optional(),
    text: z.string().optional(),
    media_url: z.string().optional(),
    media_mime_type: z.string().optional(),
  })
  .openapi("KapsoWebhookBody");

export const WebhookAcceptedSchema = z
  .object({
    status: z.literal("accepted"),
    messageId: z.string(),
    duplicate: z.boolean(),
  })
  .openapi("WebhookAccepted");

export const kapsoWebhookRoute = createRoute({
  method: "post",
  path: "/webhooks/kapso",
  summary: "Receives an inbound WhatsApp message through KAPSO",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: KapsoWebhookBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Message accepted",
      content: { "application/json": { schema: WebhookAcceptedSchema } },
    },
    400: { description: "Invalid payload" },
    401: { description: "Missing or wrong secret" },
  },
});

export function makeKapsoWebhookHandler(
  service: ReceiveInboundMessageService,
  clock: () => Date = () => new Date(),
): RouteHandler<typeof kapsoWebhookRoute> {
  return async (c) => {
    const body = c.req.valid("json");

    const result = await service.execute({
      messageId: body.id,
      from: body.from,
      kind: body.type,
      text: body.text,
      mediaUrl: body.media_url,
      mediaMimeType: body.media_mime_type,
      receivedAt: clock(),
      rawPayload: body,
    });

    return c.json(
      {
        status: "accepted" as const,
        messageId: result.messageId,
        duplicate: result.duplicate,
      },
      200,
    );
  };
}
