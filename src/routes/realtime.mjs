// src/routes/realtime.mjs — GET /api/realtime: the live-screen stream (server-sent events). Signed-in people only; they hear about THEIR workspace and nothing else.
import { changeStream } from "../realtime/hub.mjs";

export function registerRealtime(app, { runTenantScoped }) {
  app.get("/api/realtime", async (c) => {
    const { tenantId } = await runTenantScoped(c, async ({ tenantId }) => ({ tenantId }), { bucket: "documents" });
    return changeStream(tenantId, c.req.raw.signal);
  });
}
