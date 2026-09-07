import { createRoute, z, type RouteHandler } from "@hono/zod-openapi";
import type { ReceiveInboundMessageService } from "../services/receive-inbound-message.service.js";

/**
 * Shape of whatsapp.message.received, derived from real traffic. Every field stays optional
 * and unknown ones pass through: a payload we cannot read must be logged, never dropped.
 * Buffering must stay off in KAPSO, or the body arrives as a batch envelope instead.
 */
const KapsoBlockSchema = z.looseObject({
  has_media: z.boolean().optional(),
  media_url: z.string().optional(),
  media_data: z
    .looseObject({
      url: z.string().optional(),
      filename: z.string().optional(),
      byte_size: z.number().optional(),
      content_type: z.string().optional(),
    })
    .optional(),
  message_type_data: z.looseObject({ caption: z.string().optional() }).optional(),
});

const KapsoMessageSchema = z.looseObject({
  id: z.string().optional(),
  type: z.string().optional(),
  from: z.string().optional(),
  text: z.looseObject({ body: z.string().optional() }).optional(),
  kapso: KapsoBlockSchema.optional(),
});

export const KapsoWebhookBodySchema = z
  .looseObject({
    message: KapsoMessageSchema.optional(),
    conversation: z.looseObject({ phone_number: z.string().optional() }).optional(),
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
    const kapso = message?.kapso;

    const result = await service.execute({
      messageId: message?.id,
      from: message?.from ?? body.conversation?.phone_number,
      kind: message?.type,
      // kapso.content is a synthesized summary for media ("caption Image attached (...) URL: ..."),
      // so the caption is the only faithful text on those messages.
      text: message?.text?.body ?? kapso?.message_type_data?.caption,
      mediaUrl: kapso?.media_data?.url ?? kapso?.media_url,
      mediaMimeType: kapso?.media_data?.content_type,
      mediaSizeBytes: kapso?.media_data?.byte_size,
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
