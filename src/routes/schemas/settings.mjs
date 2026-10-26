// src/routes/schemas/settings.mjs — L1.5.settings (RECONCILE de-code, 27 Sep 2026): body schemas for the
// settings write routes, keyed by the row's `path` (ROUTES in src/routes/writes.mjs).
//
// ★ THE L1 RULE (specs/de-code/build/respec/L1-money.md): a schema is the handler's destructured parameter
//   list with a TYPE on each key, and NOTHING MORE. Every key is `.nullish()` (required-ness and value rules
//   stay in the handler — frozen test/c_required_fields asserts the handler's own 422s); unknown keys are
//   stripped (Zod's default) EXCEPT on a row whose handler takes `...rest` (z.looseObject — they pass
//   through, as today); `tenantId`, `actorUserId`, `principal` are never listed (the runner stamps them
//   after the parse); a key the handler only passes through, or wraps in String(), is
//   `z.unknown().optional()` — never a bare `z.unknown()`, which Zod 4 makes REQUIRED.
import { z } from "zod";

const id = z.guid();

export const SETTINGS_SCHEMAS = Object.freeze({
  // createNotification — src/notifications/writes.mjs:57
  "/api/notifications": z.object({
    recipientId: id.nullish(),
    eventId: id.nullish(),
    topic: z.string().nullish(),
    title: z.string().nullish(),
    body: z.unknown().optional(),
    deepLink: z.string().nullish(),
  }),
  // setNotificationPreference — src/notifications/writes.mjs:133
  "/api/notifications/preferences": z.object({
    appUserId: id.nullish(),
    topic: z.string().nullish(),
    channel: z.string().nullish(),
    enabled: z.boolean().nullish(),
  }),
  // markNotificationRead — src/notifications/writes.mjs:285
  "/api/notifications/read": z.object({
    notificationId: id.nullish(),
  }),
  // setNotificationRule — src/notifications/writes.mjs:217
  "/api/settings/notifications/rule": z.object({
    topic: z.string().nullish(),
    role: z.string().nullish(),
    channel: z.string().nullish(),
    enabled: z.boolean().nullish(),
  }),
  // markAllNotificationsRead — src/notifications/writes.mjs:326
  "/api/notifications/read-all": z.object({}),
  // sendTestNotification — src/notifications/writes.mjs:347
  "/api/notifications/test": z.object({
    topic: z.string().nullish(),
  }),
});
