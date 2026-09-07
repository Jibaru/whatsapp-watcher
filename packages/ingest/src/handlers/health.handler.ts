import { createRoute, z, type RouteHandler } from "@hono/zod-openapi";

export const HealthSchema = z
  .object({
    status: z.literal("ok"),
    stage: z.string(),
  })
  .openapi("Health");

export const healthRoute = createRoute({
  method: "get",
  path: "/health",
  summary: "Checks that the lambda answers",
  responses: {
    200: {
      description: "Service is up",
      content: { "application/json": { schema: HealthSchema } },
    },
  },
});

export function makeHealthHandler(stage: string): RouteHandler<typeof healthRoute> {
  return (c) => c.json({ status: "ok" as const, stage }, 200);
}
