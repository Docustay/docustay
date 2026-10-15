// Task 18.29 — DEVICE REGISTRATION FOR PUSH NOTIFICATIONS.
// Spec: specs/features/18-mobile-and-push.md §18.29 (routes).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ ROUTES FOR A SIGNED-IN PERSON TO REGISTER THEIR OWN DEVICE FOR PUSH NOTIFICATIONS.
//     Every handler below is scoped to `principal.appUserId` — the device belongs to the person
//     signed in, never to anybody named in a body parameter. Staff and client roles both
//     register and manage their own devices.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { emit, userActor } from "../events/outbox.mjs";
import { invalid } from "../http/errors.mjs";
import { registerDeviceTokenHandler } from "../notifications/push.mjs";

export function registerDeviceRoutes(app, { runTenantScoped }) {
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // POST /api/me/devices { platform: "web"|"ios"|"android", token }
  // Registers or updates a device token for push notifications.
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  app.post("/api/me/devices", (c) =>
    runTenantScoped(c, async (ctx) => {
      if (!ctx.principal?.appUserId) throw invalid("sign-in required");
      if (!ctx.body || typeof ctx.body !== "object") throw invalid("a JSON object body is required");

      const { platform, token } = ctx.body;
      if (!platform || !["web", "ios", "android"].includes(platform)) {
        throw invalid('platform must be one of: "web", "ios", "android"');
      }
      if (!token || typeof token !== "string" || token.trim().length === 0) {
        throw invalid("token is required and must be a non-empty string");
      }

      // ★ registerDeviceTokenHandler validates and upserts the token
      const { inserted } = await registerDeviceTokenHandler(ctx.db, {
        tenantId: ctx.tenantId,
        appUserId: ctx.principal.appUserId,
        platform,
        token: token.trim(),
      });

      // ★ Emit event only when a new device is registered (inserted=true)
      if (inserted) {
        await emit(ctx.db, {
          tenantId: ctx.tenantId,
          topic: "settings.push_device.registered",
          emittedBy: "settings",
          subjectType: "person",  // ★ RUN-2 T19 — "app_user" is a RETIRED alias emit() refuses
          subjectId: ctx.principal.appUserId,
          actor: userActor(ctx.principal.appUserId),
          payload: { platform },
        });
      }

      return { registered: true, inserted };
    }, { bucket: "write" }).then((r) => c.json(r, 200)));

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // POST /api/me/devices/forget { token }
  // Removes a device token registration for the signed-in person.
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  app.post("/api/me/devices/forget", (c) =>
    runTenantScoped(c, async (ctx) => {
      if (!ctx.principal?.appUserId) throw invalid("sign-in required");
      if (!ctx.body || typeof ctx.body !== "object") throw invalid("a JSON object body is required");

      const { token } = ctx.body;
      if (!token || typeof token !== "string") throw invalid("token is required");

      // ★ Delete the token if it belongs to the signed-in person
      const { rowCount } = await ctx.db.query(
        `DELETE FROM keystone.device_token
         WHERE tenant_id = $1 AND app_user_id = $2 AND token = $3`,
        [ctx.tenantId, ctx.principal.appUserId, token]);

      // ★ Emit event only when a row was actually deleted
      if (rowCount > 0) {
        await emit(ctx.db, {
          tenantId: ctx.tenantId,
          topic: "settings.push_device.removed",
          emittedBy: "settings",
          subjectType: "person",  // ★ RUN-2 T19 — "app_user" is a RETIRED alias emit() refuses
          subjectId: ctx.principal.appUserId,
          actor: userActor(ctx.principal.appUserId),
          payload: {},
        });
      }

      return { forgotten: rowCount };
    }, { bucket: "write" }).then((r) => c.json(r, 200)));

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // GET /api/me/push-config
  // Returns the server's push configuration (VAPID key, Firebase web SDK config).
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  app.get("/api/me/push-config", (c) =>
    runTenantScoped(c, async (ctx) => {
      // ★ Read VAPID key from environment
      const vapidKey = process.env.KEYSTONE_FIREBASE_WEB_PUSH_VAPID_KEY || null;
      const available = !!vapidKey;

      // ★ Firebase web config — read the public config values used by the login already
      const firebaseApiKey = process.env.KEYSTONE_FIREBASE_API_KEY || null;
      const firebaseAuthDomain = process.env.KEYSTONE_FIREBASE_AUTH_DOMAIN || null;
      const firebaseProjectId = process.env.KEYSTONE_FIREBASE_PROJECT_ID || null;
      const firebaseMessagingSenderId = process.env.KEYSTONE_FIREBASE_MESSAGING_SENDER_ID || null;
      const firebaseAppId = process.env.KEYSTONE_FIREBASE_APP_ID || null;

      const response = {
        available,
        vapidKey: available ? vapidKey : undefined,
        firebase: {
          apiKey: firebaseApiKey,
          authDomain: firebaseAuthDomain,
          projectId: firebaseProjectId,
          messagingSenderId: firebaseMessagingSenderId,
          appId: firebaseAppId,
        },
      };

      // ★ When VAPID key is unset, include the reason message
      if (!available) {
        response.reason = "Push needs one more set-up step on our side.";
      }

      return response;
    }, { bucket: "api" }).then((r) => c.json(r, 200)));
}
