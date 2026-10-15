// src/routes/schemas/network.mjs — L1.5.network (RECONCILE de-code, 27 Sep 2026): body schemas for the
// network write routes, keyed by the row's `path` (ROUTES in src/routes/writes.mjs).
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

export const NETWORK_SCHEMAS = Object.freeze({
  // createNetworkParty — src/network/writes.mjs:36
  "/api/network": z.object({
    name: z.string().nullish(),
    kind: z.string().nullish(),
    whatTheyDo: z.string().nullish(),
    email: z.string().nullish(),
    primaryContactId: id.nullish(),
    city: z.string().nullish(),
  }),
  // updateNetworkParty — src/network/writes.mjs:82
  "/api/network/update": z.object({
    partyId: id.nullish(),
    name: z.string().nullish(),
    kind: z.string().nullish(),
    whatTheyDo: z.string().nullish(),
    email: z.string().nullish(),
    primaryContactId: id.nullish(),
    city: z.string().nullish(),
  }),
});
