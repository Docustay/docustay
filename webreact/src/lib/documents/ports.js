// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DOCUMENTS ISLAND — PORTS (ISLAND-PROGRAMS.md §2 "FE"). THE ONLY PLACE ISLAND CODE MAY CALL OUTSIDE
// ENDPOINTS, or reach outside components that are not part of the island's allowed kit.
//
// Everything Documents needs from the rest of the platform — a list of people to pick from, the practice's
// plans and programs, an upload ticket — comes through a function in this file. Each is a thin wrapper
// over `request`, so the island's own files never name a People / Items / Uploads route; when one of
// those routes moves, exactly one file here changes.
//
// ★ ALLOWED IMPORTS for island files: @/lib/components/ui|kit|editor|forms|empty|lists, @/lib/format.js,
//   @/lib/idempotency.js, @/lib/hooks/*, @/lib/permissions/rank.js, @/lib/api.js (core request/ApiError),
//   @/lib/terminology/*, @/lib/phone/*, @keystone/documents/*, other island files, and THIS file.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { request } from "@/lib/api.js";
// ★ The app's one write path — the island's screens write through these (QUEUE §23.4: upload, editor, kiosk, signing). `useWrite` is the host's hook rebuilt over the SAME `writeDecision` and `send`
//   (the wall allows `permissions/write`, not the hook file), so a route's permission still comes from its own declaration and the UI cannot disagree with the server.
import { useCallback, useState } from "react";
import { useAppState } from "@/lib/app/useAppState.js";
import { writeDecision, send } from "@/lib/permissions/write.js";
export { performWrite } from "@/lib/permissions/write.js";

export function useWrite(nameOrKey, { ownerId, blockedReason = null } = {}) {
  const app = useAppState();
  const { route, decl, hidden } = writeDecision(app.permissions, nameOrKey, { ownerId, viewerId: app.me?.appUserId ?? null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = useCallback(async (...args) => {
    setBusy(true); setError(null);
    try { return await send(nameOrKey, args); } catch (err) { setError(err); throw err; } finally { setBusy(false); }
  }, [nameOrKey]);
  return { route, declaration: decl, hidden, blocked: blockedReason ? { reason: blockedReason } : null, busy, error, run };
}
import { registerVariables } from "@keystone/documents/variableCatalogue.mjs";

/** GET /api/list/people/clients — the people a document can be sent to / previewed for. `{ rows }`. */
export const listPeopleForPicker = () => request("/api/list/people/clients");

/** GET /api/list/items/plans — the practice's plans (a template can create a subscription on a plan). `{ rows }`. */
export const listPlans = () => request("/api/list/items/plans");

/**
 * POST /api/uploads/ticket — a one-shot signed upload ticket. `body` is `{ kind, contentType, bytes }`;
 * the caller then PUTs the file straight to storage with the returned ticket.
 */
export const requestUploadTicket = (body) =>
  request("/api/uploads/ticket", { method: "POST", body });

// ── LABELS (QUEUE §4, 2 Oct 2026) — Documents' own generic "used for" vocabulary ─────────────────
// A template carries opaque LABELS (`document_template.labels`, empty = used for everyone). Documents has no idea
// what a program or a client type is; the HOST (the platform) maps them onto label strings and plugs two functions in
// ONCE at startup (`@/lib/host/documentsHost.js`, imported by `main.jsx`). Until plugged, both answer "nothing" —
// the template editor offers no choices and nothing is ever suggested or warned about. Sending is never blocked.
let host = {};
/**
 * Called once by the host. `impl` is `{ labelOptions?, labelsForPerson?, variables? }`. `variables` is `{ entries, neverResolves? }` — the host's merge-field namespaces (person.*, booking.*, money.* …), registered into the
 * island's live catalogue (QUEUE §23.3.3), the same list the server registers, so the editor's picker offers exactly what the server can resolve.
 */
export function plugDocumentsHost(impl) {
  const { variables, ...rest } = impl ?? {};
  host = { ...host, ...rest };
  if (variables?.entries) registerVariables(variables.entries, { neverResolves: variables.neverResolves ?? [] });
}

/** → Promise<[{ key, label, group }]> — every label a template can be marked "used for", grouped for the picker. */
export const labelOptions = async () => {
  try { const r = await host.labelOptions?.(); return Array.isArray(r) ? r : []; } catch { return []; }
};
/** (personId) → Promise<string[]> — the labels that describe one person (empty when unknown). */
export const labelsForPerson = async (personId) => {
  if (!personId) return [];
  try { const r = await host.labelsForPerson?.(personId); return Array.isArray(r) ? r : []; } catch { return []; }
};
