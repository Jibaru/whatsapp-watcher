import { createRoute, z, type RouteHandler } from "@hono/zod-openapi";
import type { ReceiveInboundMessageService } from "../services/receive-inbound-message.service.js";

/**
 * Esquema PROVISIONAL: aún no está confirmado el formato real del webhook de KAPSO.
 * Por eso es un objeto laxo con todo opcional — un payload inesperado se registra,
 * no se rechaza. Se cerrará en cuanto CloudWatch enseñe el primer mensaje real.
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
  summary: "Recibe un mensaje entrante de WhatsApp vía KAPSO",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: KapsoWebhookBodySchema } },
    },
  },
  responses: {
    200: {
      description: "Mensaje aceptado",
      content: { "application/json": { schema: WebhookAcceptedSchema } },
    },
    400: { description: "Payload inválido" },
    401: { description: "Secreto ausente o incorrecto" },
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
