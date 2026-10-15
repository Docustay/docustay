// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 8.19 — `/account/security`. "WHERE AM I SIGNED IN", REACHED FROM THE AVATAR MENU, EVERY ROLE.
//
// ★★★ NOT `SignInDevicesScreen` (6.13's `/settings/sign-in`) — that one is staff-only, over an
//     earlier, different session-list route. This one is 8.14's `GET /api/auth/sessions`, and
//     every role has it (Owner, Admin, Coach and client all have sessions).
//
// ★★ TWO PANELS. Two-step's controls and dialogs are task 8.20's, in the NEXT group — until that
//    task lands, this panel shows a single disabled row with the reason "Not switched on yet".
//    ★ That placeholder is replaced by `<TwoStepPanel …/>` inside THIS stage (8.20's field 2
//    names the exact swap) — a panel that ships disabled past its own stage is the dead-control
//    defect this project has already measured once.
//
// ★★★ NO IP ADDRESS ANYWHERE ON THIS SCREEN. 8.14's route does not return one (its own comment:
//     "No IP, no full user-agent") and this screen must not add a lookup of its own — the row
//     renders `kind`, `userAgentSummary`, `createdAt`, `expiresAt` only.
//
// ★★ AFTER A REVOKE, THE SCREEN NEVER MUTATES ITS OWN COPY. `onDone()` is `Screen.svelte`'s own
//    `() => (app.refetchSignal += 1)` idiom (`:122`) — the parent re-fetches and hands back a new
//    `view` prop. A list that edits itself and a server that refused are two different answers.
//
// ★ EACH MUTATING CALL MINTS ITS OWN Idempotency-Key AND HOLDS IT IN COMPONENT STATE, ONE KEY PER
//   SUBMIT, RE-USED ON A RETRY OF THAT SAME ACTION — the same discipline `SignInDevicesScreen`
//   (6.13) and the sign-up page already use.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { ApiError, request } from "@/lib/api.js";
import { newIdempotencyKey } from "@/lib/idempotency.js";
import TwoStepPanel from "@/lib/screens/TwoStepPanel.jsx";
import SecurityScreenTable1Table from "@/lib/screens/SecurityScreenTable1Table.jsx";

export default function SecurityScreen({ view = null, onDone = null }) {
  const sessions = view?.sessions ?? [];
  const current = view?.current ?? null;

  const [busyTokenId, setBusyTokenId] = useState(null);
  const [othersBusy, setOthersBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  // ★ Plain objects, not `$state` — they drive no rendering, they exist only so a retry of the SAME
  //   click sends the SAME key.
  const [revokeKeys] = useState({});
  const [othersKey, setOthersKey] = useState(null);

  const when = (t) => {
    if (!t) return "—";
    const d = new Date(t);
    return Number.isNaN(d.getTime())
      ? String(t)
      : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  };

  /** One row's "Sign out" — `POST /api/auth/sessions/revoke` with `{tokenId}`. */
  async function signOutOne(tokenId) {
    if (busyTokenId) return;
    setBusyTokenId(tokenId);
    setProblem(null);
    revokeKeys[tokenId] ??= newIdempotencyKey();
    try {
      await request("/api/auth/sessions/revoke", {
        method: "POST",
        body: { tokenId },
        idempotencyKey: revokeKeys[tokenId],
      });
      delete revokeKeys[tokenId];
      onDone?.();
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusyTokenId(null);
    }
  }

  /** "Sign out everywhere else" — the SAME route, `{all:true}`, keeps the caller's own session. */
  async function signOutEverywhereElse() {
    // ★★ Disabled at one session in the DOM already; guarded here too — belt and braces, not a
    //    substitute (same idiom SignInDevicesScreen's `revokeOthers` uses).
    if (othersBusy || sessions.length <= 1) return;
    setOthersBusy(true);
    setProblem(null);
    let currentOthersKey = othersKey;
    if (!currentOthersKey) {
      currentOthersKey = newIdempotencyKey();
      setOthersKey(currentOthersKey);
    }
    try {
      await request("/api/auth/sessions/revoke", {
        method: "POST",
        body: { all: true },
        idempotencyKey: currentOthersKey,
      });
      setOthersKey(null);
      onDone?.();
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setOthersBusy(false);
    }
  }

  return (
    <div className="grid gap-lg">
      <div className="border-b border-line pb-4">
        <h1 className="text-h2 font-semibold text-ink">Sign-in and security</h1>
      </div>

      <section data-testid="security-twostep-panel" className="grid gap-4">
        <h2 className="text-h3 font-semibold text-ink">Two-step sign-in</h2>
        <TwoStepPanel />
      </section>

      <section data-testid="security-sessions-panel" className="grid gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-h3 font-semibold text-ink">Where you are signed in</h2>
          <button
            type="button"
            className="px-4 py-2 bg-primary text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary-dark transition-colors"
            data-testid="security-signout-everywhere"
            disabled={sessions.length <= 1 || othersBusy}
            onClick={signOutEverywhereElse}
          >
            Sign out everywhere else
          </button>
        </div>

        {problem && (
          <p
            className="text-sm text-red-600 m-0"
            data-testid="security-problem"
            role="alert"
          >
            {problem}
          </p>
        )}

        {sessions.length === 0 ? (
          <p data-testid="security-sessions-empty">No sessions to show right now.</p>
        ) : (
          <SecurityScreenTable1Table
            sessions={sessions}
            current={current}
            busyTokenId={busyTokenId}
            when={when}
            signOutOne={signOutOne}
          />
        )}
      </section>
    </div>
  );
}
