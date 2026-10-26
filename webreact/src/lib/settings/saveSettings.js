// ═══════════════════════════════════════════════════════════════════════════════════════════════
// TASK 11.23 (CT-F44) — BATCH SETTINGS SAVE: ONE TRANSACTION, ONE STATE PER KEY.
//
// ★★★ ATOMICITY IS OBTAINED BY THROWING, NOT BY OPENING A TRANSACTION. The handler (POST
//     /api/settings) already runs inside one `withTenant` transaction (app.mjs, db/index.mjs),
//     so a failure throws, the whole transaction rolls back — including the keys already upserted
//     AND the events `setSetting` emitted for them (they live in the outbox on the same tx). One
//     key fails ⇒ zero keys changed and zero events written. A try/catch that logged and
//     continued would produce exactly the half-saved state the promise forbids, so there is no
//     continue in this handler.
//
// ★ This client module consumes that shape:
//   - success: {ok:true, rows}
//   - refused: {ok:false, kind:'refused', rows, reference}
//   - reach: {ok:false, kind:'reach', reach, reference}
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { api, ApiError } from "@/lib/api.js";

/**
 * ★★★ Helper: convert request ID to 8-char reference (same as server side).
 * Matches the server logic at routes/settings.mjs:2048-2049.
 */
function referenceFromRequestId(rawRequestId) {
  const rawString = String(rawRequestId ?? "");
  const hexOnly = rawString.replace(/[^0-9a-f]/gi, "");
  return hexOnly.length >= 8 ? hexOnly.slice(0, 8).toLowerCase() : rawString.slice(0, 8);
}

/**
 * Batch save settings atomically. All changes land or none of them do.
 *
 * @param {Array<{key, value}>} changes - the settings to change
 * @param {{confirm?: {reach?: boolean, tell?: {message?: string}}}} options - optional reach confirmation
 * @returns {Promise<{ok: true, rows} | {ok: false, kind: 'refused'|'reach', rows?, reach?, reference?}>}
 *
 * ★ Success: {ok:true, rows} where rows = [{key, value, state: "saved"}, ...]
 * ★ Refused (validation error): {ok:false, kind:'refused', rows, reference}
 *   where rows per-key state is "saved", "refused", or "not_saved", and reason is only on the
 *   refused row. The transaction rolled back — no keys changed, no events.
 * ★ Reach (confirmation needed): {ok:false, kind:'reach', reach, reference}
 *   The server computed what this change reaches (future bookings affected, etc.) — show the
 *   modal (17.4) and call again with confirm: {reach: true, tell: {message}}.
 *
 * ★★★ FOUND LIVE, 29 Sep 2026 — this took a `run` function first ("useWrite('setSettings').run",
 *     a permission-hook indirection that was never actually built) and EVERY real caller
 *     (SettingsForm.jsx, both call sites, the only two call sites anywhere in webreact/) has
 *     always called it as `saveSettings(changes, {confirm})` — passing the changes ARRAY as
 *     `run`, then this code did `await run({changes, confirm})`, i.e. called an array as a
 *     function. Every settings screen's every Save button has thrown "run is not a function"
 *     (minified to a single letter in production) since the React port shipped — CLAUDE.md's
 *     ORPHAN/SHAPE-ASSUMED class, and a severe one: this component is shared by every settings
 *     screen in the app, not just Documents. Fixed to call the real, already-built, already-
 *     idempotent `api.setSettings` directly — the same endpoint the vestigial `run` was always
 *     going to hit anyway, per this file's own docstring below.
 */
export async function saveSettings(changes, { confirm } = {}) {
  try {
    const response = await api.setSettings({ changes, confirm });
    // Success — the handler returns {saved: true, rows: [...]}
    return {
      ok: true,
      rows: response.rows,
    };
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;

    // Refused — validation error (400). A key had a bad value or RLS refused, caught by setSetting.
    if (err.status === 400) {
      const reference = referenceFromRequestId(err.requestId);
      const detail = err.body?.error?.detail ?? {};
      return {
        ok: false,
        kind: "refused",
        rows: detail.rows ?? [],
        reference,
      };
    }

    // Reach — confirmation needed (409). The change affects existing bookings.
    if (err.status === 409) {
      const reference = referenceFromRequestId(err.requestId);
      const detail = err.body?.error?.detail ?? {};
      return {
        ok: false,
        kind: "reach",
        reach: detail.reach ?? [],
        reference,
      };
    }

    // Any other error (401, 403, 500, etc.) — re-throw so the caller can handle it.
    throw err;
  }
}
