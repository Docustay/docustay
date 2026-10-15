// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PersonActionsPersonInviteSheet — "Send an invitation" (R4.027.M4).
// Ported from webui/src/lib/record/PersonActions.svelte:241-271 (the ActionSurface element and
// everything inside it); shown when inside the {#if inviteOpen} block at line 240.
// Exports default function PersonActionsPersonInviteSheet({ open, onOpenChange, person, busy, problem, resendInvite })
// Props are exactly the parent-scope values the source range reads (person, inviteOpen, busy,
// problem, resendInvite), same names; functions stay functions (the parent passes its handler).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/lib/components/ui/button.jsx";
import { useEscape, useFocusTrapLite } from "@/lib/hooks/useOverlay.js";
import { ICON_STROKE } from "@/lib/empty/icons.js";

// ★ the maintainer, 29 Sep 2026 — THREE MODES, ONE SHEET. `invite`/`resend` are the same server call
//   (`api.resendInvitePerson`, F632 — the server does not distinguish first send from resend); the
//   copy differs only in verb tense. `portal_link` is a DIFFERENT call (`api.sendPortalLink`,
//   no token, no expiry) for somebody who has already signed in. `isTeen` swaps the recipient
//   language — "sign in" applies to their state, but "invitation" and "link" arrive in the
//   PARENT'S inbox, never the teen's own (spec: "teens → the invite goes to their linked parent").
const COPY = {
  invite: { title: "Send a portal invite", submitLabel: "Send the invite" },
  resend: { title: "Resend the portal invite", submitLabel: "Resend the invite" },
  portal_link: { title: "Send a portal sign-in link", submitLabel: "Send the link" },
};

export default function PersonActionsPersonInviteSheet({
  open, onOpenChange, person, busy, problem, resendInvite, mode = "invite", isTeen = false, ttlDays = 7,
}) {
  const panel = useRef(null);

  useEscape(() => { if (!busy) onOpenChange?.(false); });
  useFocusTrapLite(panel);

  if (!open) return null;

  const copy = COPY[mode] ?? COPY.invite;
  const who = isTeen ? "their linked parent" : <><strong>{person?.display_name}</strong> ({person?.email})</>;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim" role="presentation"
         onClick={(e) => { if (e.target === e.currentTarget && !busy) onOpenChange?.(false); }}>
      <form ref={panel} className="w-[440px] max-w-[calc(100%-2rem)] rounded-lg border border-line bg-surface shadow-overlay"
            role="dialog" aria-modal="true" aria-label={copy.title} data-testid="person-invite"
            onSubmit={(e) => { e.preventDefault(); if (!busy) resendInvite?.(); }}>
        <header className="flex items-center justify-between gap-3 border-b border-line px-6 py-5">
          <h2 className="m-0 text-lg font-medium text-ink">{copy.title}</h2>
          <button type="button" className="inline-flex size-10 items-center justify-center rounded-full border border-line bg-surface text-ink-muted hover:bg-surface-sunken"
                  onClick={() => onOpenChange?.(false)} disabled={busy} aria-label="Close">
            <X strokeWidth={ICON_STROKE} className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="flex flex-col gap-4 px-6 py-7">
          {mode === "portal_link" ? (
            <>
              <p className="m-0 text-sm text-ink" data-testid="person-invite-what">
                This sends {who} an email with a link to where they sign in. It carries no
                credential of its own — their password still gates the portal.
              </p>
              {isTeen && (
                <p className="m-0 text-xs text-mute">
                  {person?.display_name} is under 18, so this goes to the parent on their account,
                  not to {person?.display_name} directly.
                </p>
              )}
            </>
          ) : (
            <>
              {/* ═══════════════════════════════════════════════════════════════════════════════
                 ★★★ TASK 8.15 — THE COPY BELOW IS TRUE NOW. 8.6 built `keystone.invite` and a real
                     link token; `resendInvite` (F632) revokes whatever is open for this address,
                     then mints a fresh one — "one-use, 30 days" is the maintainer's 29 Sep 2026 ruling for a
                     CLIENT invite specifically (a staff invite still reads 7 days — see
                     PersonActions.jsx's own `isStaff` branch, unedited).
              ═══════════════════════════════════════════════════════════════════════════════ */}
              <p className="m-0 text-sm text-ink" data-testid="person-invite-what">
                This sends {who} a link to set a password and sign in.
              </p>
              {isTeen && (
                <p className="m-0 text-xs text-mute">
                  {person?.display_name} is under 18, so the invite goes to the parent on their
                  account, not to {person?.display_name} directly.
                </p>
              )}
              <p className="m-0 text-xs text-mute" data-testid="person-invite-truth">
                The link works once and expires in {ttlDays} days.
                Sending a new one stops any earlier link working.
              </p>
            </>
          )}

          {problem && <p className="m-0 rounded-sm border border-bad-border bg-bad-bg px-3 py-2.5 text-xs text-bad" role="alert">{problem}</p>}
        </div>

        <footer className="flex shrink-0 justify-end gap-3 border-t border-line bg-surface px-6 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange?.(false)} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : copy.submitLabel}</Button>
        </footer>
      </form>
    </div>
  );
}
