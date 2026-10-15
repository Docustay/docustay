// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.036 — `/settings/sign-in`. THE PERSON'S OWN SESSIONS, NEVER A COLLEAGUE'S.
//
// ★★★ THE SCOPING RULE IS THE SERVER'S (6.12), NOT THIS SCREEN'S. `GET /api/settings/sign-in`
//     already returns only `principal.appUserId`'s sessions, with `current` flagged on the one the
//     browser is asking from. This screen draws exactly what it is handed — there is no "whose
//     sessions" filter here to get wrong.
//
// ★★ REMOVE IS OFFERED ON EVERY ROW, INCLUDING THE CURRENT ONE (6.12 allows it). Removing your own
//    current session is a normal thing to do — the next request 401s and the shell's existing
//    401 handling takes the person to the login screen. No special case lives in this screen.
//
// ★★★ EACH MUTATING CALL MINTS ITS OWN Idempotency-Key AND HOLDS IT IN COMPONENT STATE, ONE KEY
//     PER SUBMIT, RE-USED ON A RETRY OF THAT SAME ACTION — exactly the discipline the sign-up page
//     uses. The key is cleared once the action reaches a definitive end (success), so a later,
//     distinct click mints a new one.
//
// ★ Ruling R-40: the "My notification preferences" section (source lines 259-297 in Svelte) is
//   NOT ported here — it moves to `SettingsMine` ("You"), task RP.8. This page keeps sessions,
//   devices and two-step only.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { ApiError, api } from "@/lib/api.js";
import { newIdempotencyKey } from "@/lib/idempotency.js";
import { Button } from "@/lib/components/ui/button.jsx";
import PageHeader from "@/lib/lists/PageHeader.jsx";
import EmptyState from "@/lib/empty/EmptyState.jsx";
import SignInDevicesScreenTable1Table from "@/lib/screens/SignInDevicesScreenTable1Table.jsx";

export default function SignInDevicesScreen({ view = null, rank = null, onDone = null }) {
  const sessions = view?.sessions ?? [];

  const [removingId, setRemovingId] = useState(null);
  const [othersBusy, setOthersBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  // ★ Plain objects, not state — they drive no rendering, they exist only so a retry of the SAME
  //   click sends the SAME key.
  const [revokeKeys] = useState({});
  const [othersKey, setOthersKey] = useState(null);

  const when = (t) => {
    if (!t) return "—";
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? String(t) : d.toLocaleDateString(undefined, { dateStyle: "medium" });
  };

  /** `null` renders as "not used yet" — a fact, not a blank cell. */
  const lastUsed = (t) => {
    if (!t) return "not used yet";
    const d = new Date(t);
    if (Number.isNaN(d.getTime())) return String(t);
    const minutes = Math.round((Date.now() - d.getTime()) / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  };

  /** ★ A tiny local mapper, not a library — the device shown is "browser on platform", never the
   *  raw string. `null` renders as "Unknown device". */
  const deviceLabel = (ua) => {
    if (!ua) return "Unknown device";
    const browser =
      /Edg\//.test(ua) ? "Edge"
      : /OPR\//.test(ua) ? "Opera"
      : /Firefox\//.test(ua) ? "Firefox"
      : /Chrome\//.test(ua) ? "Chrome"
      : /Safari\//.test(ua) ? "Safari"
      : "Unknown browser";
    const platform =
      /Windows/.test(ua) ? "Windows"
      : /Mac OS X/.test(ua) ? "macOS"
      : /Android/.test(ua) ? "Android"
      : /iPhone|iPad|iPod/.test(ua) ? "iOS"
      : /Linux/.test(ua) ? "Linux"
      : "an unknown platform";
    return `${browser} on ${platform}`;
  };

  /** Q6-7 — IPv4 first three octets + ".x"; IPv6 first four groups + "::". `null` renders as
   *  "Unknown location". Never the full address. */
  const truncateAddress = (ip) => {
    if (!ip) return "Unknown location";
    if (ip.includes(":")) {
      const groups = ip.split(":").slice(0, 4);
      return `${groups.join(":")}::`;
    }
    const octets = ip.split(".");
    return octets.length === 4 ? `${octets.slice(0, 3).join(".")}.x` : ip;
  };

  async function removeSession(sessionId) {
    if (removingId) return;
    setRemovingId(sessionId);
    setProblem(null);
    revokeKeys[sessionId] ??= newIdempotencyKey();
    try {
      await api.revokeSession(sessionId, revokeKeys[sessionId]);
      delete revokeKeys[sessionId];
      onDone?.();
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setRemovingId(null);
    }
  }

  async function revokeOthers() {
    // ★★ Disabled at one row in the DOM already; guarded here too, since a disabled control is a
    //    rendering fact and this is the behavioural one — belt and braces, not a substitute.
    if (othersBusy || sessions.length <= 1) return;
    setOthersBusy(true);
    setProblem(null);
    setOthersKey((prev) => prev ?? newIdempotencyKey());
    const key = othersKey ?? newIdempotencyKey();
    try {
      await api.revokeOtherSessions(key);
      setOthersKey(null);
      onDone?.();
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setOthersBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Sign-in and devices" count={sessions.length} total={sessions.length} noun="session">
        <Button
          variant="default"
          size="default"
          data-testid="signin-revoke-others"
          disabled={sessions.length <= 1 || othersBusy}
          onClick={revokeOthers}
        >
          Sign out my other devices
        </Button>
      </PageHeader>

      {problem && (
        <p className="mb-4 text-sm text-destructive" data-testid="signin-error" role="alert">
          {problem}
        </p>
      )}

      {sessions.length === 0 ? (
        // ★ Never actually reached — the caller always has at least one session (their own, live).
        //   Said plainly rather than left spinning if it somehow is.
        <EmptyState
          kind="first-run"
          headline="No sessions to show"
          line="No sessions to show right now."
          testId="signin-empty"
        />
      ) : (
        <SignInDevicesScreenTable1Table
          sessions={sessions}
          removingId={removingId}
          when={when}
          lastUsed={lastUsed}
          deviceLabel={deviceLabel}
          truncateAddress={truncateAddress}
          removeSession={removeSession}
        />
      )}
    </>
  );
}
