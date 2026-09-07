import { createRoute, z, type RouteHandler } from "@hono/zod-openapi";
import type { ReceiveInboundMessageService } from "../services/receive-inbound-message.service.js";

/**
 * Shape of whatsapp.message.received. Every field stays optional and unknown ones pass
 * through: a payload we cannot read must be logged, never dropped. Buffering must stay off
 * in KAPSO, or the body arrives as a batch envelope instead of a single message.
 */
const KapsoMessageSchema = z.looseObject({
  id: z.string().optional(),
  type: z.string().optional(),
  from: z.string().optional(),
  text: z.looseObject({ body: z.string().optional() }).optional(),
  kapso: z
    .looseObject({
      has_media: z.boolean().optional(),
      media_url: z.string().optional(),
      content: z.string().optional(),
    })
    .optional(),
});

export const KapsoWebhookBodySchema = z
  .looseObject({
    message: KapsoMessageSchema.optional(),
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
    401: { description: "Missing or wrong signature" },
  },
});

export function makeKapsoWebhookHandler(
  service: ReceiveInboundMessageService,
  clock: () => Date = () => new Date(),
): RouteHandler<typeof kapsoWebhookRoute> {
  return async (c) => {
    const body = c.req.valid("json");
    const message = body.message;

    const result = await service.execute({
      messageId: message?.id,
      from: message?.from,
      kind: message?.type,
      text: message?.text?.body ?? message?.kapso?.content,
      mediaUrl: message?.kapso?.media_url,
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
