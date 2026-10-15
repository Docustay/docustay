// ═══════════════════════════════════════════════════════════════════════════════════════════════
// TASK R4.014 — TeamSeeAs. Ported from webui/src/lib/screens/people/TeamSeeAs.svelte
// (316 lines, 50 in <style>). Built on none (part — composes kit components). Layout from
// frame, behaviour from Svelte source.
//
// ★★★ THE MOUNT DOES ITS OWN FETCH, DELIBERATELY — same reasoning `SchedulingScreen.svelte`
//     (12.30) and `NetworkReleases.svelte` (12.34) already record: this screen is not in 12.36's
//     `DEDICATED_SCREENS` pre-fetch map yet (that mount lands with 12.36), so loading/error/
//     denied are owned HERE, via `ScreenState` (field 14), not inherited from `Screen.svelte`.
//
// ★★★ THE SEQUENCE, PER FIELD 4: fetch the summary with the REAL identity (before entering
//     see-as) → cache it in `sessionStorage['seeAs:'+id]` → THEN enter see-as. On a normal first
//     visit both calls run, in that order, on mount. `sessionStorage` also carries an `active`
//     flag: a RELOAD of this same tab while already previewing skips straight to rendering the
//     banner + Stop only (no lists) from the cached identity, rather than re-running the whole
//     enter sequence a second time (which would 409 "already previewing").
//
// ★★★ THIS SCREEN NEVER SHOWS A NAME IT DID NOT ALREADY HAVE THE RIGHT TO SHOW. `can`/`cannot`
//     carry COUNTS ONLY (`GET .../see-as-summary`'s own contract) — no client is ever named here.
//     The screen reports what the target's grants allow; it never becomes a way to see more than
//     the viewer (an Owner/Admin, per the route`s own 403-a-Coach gate) already could.`
//
// ★★★ they/them THROUGHOUT — `app_user` carries no reliable gender column, so every "her"/"she" in
//     this task's own field 4 and the frame's Robin illustration is rendered gender-neutral here,
//     same fix `TeamRemoveScreen.svelte` (12.27) already made to this same plan's copy tonight.
//
// ★ NO `EmptyState` ON THIS SCREEN (field 13's own note, COMPONENTS field) — the ten rows are a
//   FIXED list derived from grants and never all disappear at once; a side with zero rows for it
//   renders one inline line, "Nothing on this side for {first}.", not the full-width `.ks-state`
//   band `EmptyState` is built for.
//
// ★ `ViewingAsBanner` (`$lib/shell/ViewingAsBanner.svelte`) is reused for its STOP CONTROL'S OWN
//   busy/error idiom (mint a promise, disable while in flight, surface the server's own message
//   on failure) — never mounted here wholesale, because its own fixed banner text ("You're
//   previewing the platform as… Nothing you do here is saved.") is DIFFERENT COPY from this screen's
//   own banner, which field 4 quotes verbatim and the frame (`:262`) draws as in-page content, not
//   the fixed chrome-wide strip. The Stop BUTTON here is never forked from a second component file
//   — it is this screen's own control, built to the identical pattern.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from "react";
import { api, ApiError } from "@/lib/api.js";
import { Badge } from "@/lib/components/ui/badge.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";

function firstNameOf(name) {
  const s = String(name ?? "").trim();
  if (!s) return "this team member";
  return s.split(/\s+/)[0];
}

export default function TeamSeeAs({ personId = null, onNavigate = null }) {
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);        // { person, can, cannot }
  const [viewingAs, setViewingAs] = useState(null);    // { id, displayName, staffRole, expiresAt } — from teamSeeAs()
  const [reloadOnly, setReloadOnly] = useState(false);  // true when a reload found an ALREADY-active preview
  const [stopBusy, setStopBusy] = useState(false);
  const [stopError, setStopError] = useState(null);

  const storageKey = useMemo(() => (personId ? `seeAs:${personId}` : null), [personId]);

  function readCache() {
    if (!storageKey) return null;
    try {
      const raw = sessionStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeCache(value) {
    if (!storageKey) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* best-effort only */ }
  }

  function clearCache() {
    if (!storageKey) return;
    try { sessionStorage.removeItem(storageKey); } catch { /* best-effort only */ }
  }

  async function load() {
    if (!personId) {
      setPhase("error");
      setError({ message: "No team member was named to preview as." });
      return;
    }
    setPhase("loading");
    setError(null);
    setReloadOnly(false);

    const cached = readCache();
    if (cached?.active) {
      // ★ Reload during an already-active preview — field 14's own line. Render the banner + Stop
      //   only, from the cached identity, without re-running the fetch-then-enter sequence (which
      //   would 409 "already previewing" against a session that is already open).
      setSummary(cached.summary ?? null);
      setViewingAs(cached.viewingAs ?? null);
      setReloadOnly(true);
      setPhase("ready");
      return;
    }

    try {
      const fetched = await api.seeAsSummary(personId);
      setSummary(fetched);
      writeCache({ summary: fetched, viewingAs: null, active: false });

      const entered = await api.teamSeeAs({ personId });
      setViewingAs(entered?.viewingAs ?? null);
      writeCache({ summary: fetched, viewingAs: entered?.viewingAs ?? null, active: true });

      setPhase("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setPhase("denied");
        setError(err);
      } else {
        setPhase("error");
        setError(err instanceof ApiError
          ? { message: err.message, requestId: err.requestId }
          : { message: String(err?.message ?? err) });
      }
    }
  }

  useEffect(() => {
    void personId;
    load();
  }, [personId]);

  async function stop() {
    if (stopBusy) return;
    setStopBusy(true);
    setStopError(null);
    try {
      await api.teamSeeAsExit();
      clearCache();
      onNavigate?.("/people/team");
    } catch (err) {
      setStopError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setStopBusy(false);
    }
  }

  const person = useMemo(() => summary?.person ?? viewingAs ?? { id: personId, displayName: "this team member", staffRole: null, roleLabel: null }, [summary, viewingAs, personId]);
  const firstName = useMemo(() => firstNameOf(person.displayName), [person.displayName]);
  const roleLabel = useMemo(() => {
    if (person.roleLabel) return person.roleLabel;
    if (person.staffRole) {
      return person.staffRole.charAt(0).toUpperCase() + person.staffRole.slice(1);
    }
    return "Staff";
  }, [person.staffRole, person.roleLabel]);

  const WHY = [
    {
      headline: "To check before you complain",
      line: 'Most "why can\'t they see that" questions are answered in ten seconds here.',
    },
    {
      headline: "It changes nothing",
      line: "Read only, always. You can't book, send or save while you're in here.",
    },
  ];

  function go(href) {
    onNavigate?.(href);
  }

  return (
    <div className="flex flex-col gap-4.5" data-testid="team-see-as">
      <div className="flex items-center gap-3.5 rounded-control py-3.25 px-4.25 bg-ink text-white" data-testid="team-see-as-banner">
        <span className="flex-1 text-sm leading-1.5">
          You&rsquo;re looking at Workbench as {firstName} would see it. Nothing you do here changes
          anything, and {firstName} isn&rsquo;t told.
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-white/30 text-white"
          disabled={stopBusy}
          onClick={stop}
          data-testid="team-see-as-stop"
        >
          {stopBusy ? "Stopping…" : "Stop"}
        </Button>
        {stopError && (
          <span className="text-error-100 text-sm" role="alert" data-testid="team-see-as-stop-error">{stopError}</span>
        )}
      </div>

      <ScreenState
        phase={phase}
        error={phase === "error" ? error : null}
        reason={phase === "denied" ? "Only an Owner or Admin can preview another team member's view." : null}
        onNavigate={go}
        onRetry={() => load()}
      >
        {reloadOnly || !summary ? (
          <p className="m-0 rounded-xs py-3.5 px-4 bg-notice-wash text-notice-ink text-sm" data-testid="team-see-as-reload-note">
            You&rsquo;re still previewing as {firstName}. Stop to see the full breakdown again.
          </p>
        ) : (
          <div className="flex flex-col">
            <div className="mb-1">
              <h1 className="m-0 text-title font-title text-ink tracking-tighter" data-testid="team-see-as-title">What {firstName} sees</h1>
              <p className="m-0 mt-1.25 text-sm text-mute" data-testid="team-see-as-subtitle">{roleLabel} role, their own clients.</p>
            </div>

            <div className="flex gap-5.5 items-start">
              <div className="flex-1 min-w-0 flex flex-col gap-4.5">
                <div className="bg-surface border border-line rounded-card" data-testid="team-see-as-can">
                  <div className="px-4.25 py-3.5 border-b border-hair font-medium text-sm"><b>They can see</b></div>
                  <div className="pt-1.5 px-4.25 pb-3.5">
                    {summary.can.length === 0 ? (
                      <p className="m-0 my-2.75 text-sm text-mute" data-testid="team-see-as-can-empty">
                        Nothing on this side for {firstName}.
                      </p>
                    ) : (
                      summary.can.map((row) => (
                        <div key={row.label} className="flex items-center gap-3 py-2.75 border-b border-hair last:border-b-0 text-sm" data-testid="team-see-as-can-row">
                          <span className="flex-1 flex flex-col gap-0.5">
                            {row.label}<span className="text-xs text-mute">{row.detail}</span>
                          </span>
                          <Badge variant="secondary">Yes</Badge>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="bg-surface border border-line rounded-card" data-testid="team-see-as-cannot">
                  <div className="px-4.25 py-3.5 border-b border-hair font-medium text-sm"><b>They can&rsquo;t see</b></div>
                  <div className="pt-1.5 px-4.25 pb-3.5">
                    {summary.cannot.length === 0 ? (
                      <p className="m-0 my-2.75 text-sm text-mute" data-testid="team-see-as-cannot-empty">
                        Nothing on this side for {firstName}.
                      </p>
                    ) : (
                      summary.cannot.map((row) => (
                        <div key={row.label} className="flex items-center gap-3 py-2.75 border-b border-hair last:border-b-0 text-sm" data-testid="team-see-as-cannot-row">
                          <span className="flex-1 flex flex-col gap-0.5">
                            {row.label}<span className="text-xs text-mute">{row.detail}</span>
                          </span>
                          <Badge variant="outline">Hidden</Badge>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="w-80 flex-0">
                <div className="bg-surface border border-line rounded-card" data-testid="team-see-as-why">
                  <div className="px-4.25 py-3.5 border-b border-hair font-medium text-sm"><b>Why this exists</b></div>
                  <div className="pt-1.5 px-4.25 pb-3.5">
                    {WHY.map((row) => (
                      <div key={row.headline} className="flex items-start gap-3 py-2.75 border-b border-hair last:border-b-0 text-sm">
                        <span className="flex-1 flex flex-col gap-0.5">
                          {row.headline}<span className="text-xs text-mute">{row.line}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </ScreenState>
    </div>
  );
}
