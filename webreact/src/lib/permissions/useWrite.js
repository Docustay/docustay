// ═══════════════════════════════════════════════════════════════════════════════════════════════
// useWrite — THE ONLY WAY A COMPONENT WRITES (REACT-PLAN §4.5, R-34, R-35).
//
//   const refund = useWrite("refundInvoice", { ownerId, blockedReason });   // an api.js method name
//   const save   = useWrite("POST /api/settings/practice/slug");             // or a route key
//   <WriteButton write={refund} onClick={() => refund.run({ invoiceId })}>Refund</WriteButton>
//
// ★★★ The route's permission comes from ITS OWN DECLARATION (routePermissions.json — WRITE_ROUTES +
//     src/permissions/routeDeclarations.mjs, gate RP.9). The component never states a permission, so the
//     UI cannot disagree with the server about which one applies.
//   · hidden   — the viewer's permissions say no → WriteButton renders NOTHING
//   · blocked  — a missing prerequisite the caller supplies (e.g. "Connect Stripe first") → DISABLED WITH
//                THE REASON. Never the other way round (the maintainer's rule; RECON §11).
//   · run(...) — calls the api.js method (or the route) and tracks busy/error.
//   · performWrite(permissions, name, args) — the same check without a hook, for the app store only.
// ★ gate react_code_rules.mjs K6a: api.js write methods are callable only from write.js (which this wraps).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useCallback, useState } from "react";
import { useAppState } from "@/lib/app/useAppState.js";
import { writeDecision, send } from "./write.js";

export { resolveRoute, writeDecision, performWrite, WriteRefused } from "./write.js";

export function useWrite(nameOrKey, { ownerId, blockedReason = null } = {}) {
  const app = useAppState();
  const { route, decl, hidden } = writeDecision(app.permissions, nameOrKey, { ownerId, viewerId: app.me?.appUserId ?? null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const run = useCallback(async (...args) => {
    setBusy(true); setError(null);
    try {
      return await send(nameOrKey, args);
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setBusy(false);
    }
  }, [nameOrKey]);

  return { route, declaration: decl, hidden, blocked: blockedReason ? { reason: blockedReason } : null, busy, error, run };
}
