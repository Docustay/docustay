// ═══════════════════════════════════════════════════════════════════════════════════════════════
// TeamInviteDrawer — Invite someone to the team with role, location, and message.
// Ported from webui/src/lib/screens/people/TeamInviteDrawer.svelte (264 lines).
// Uses SideSheet archetype; layout/behaviour from Svelte source; styling from kit components + tokens.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { useState, useMemo } from "react";
import { api, ApiError } from "@/lib/api.js";
import SideSheet from "@/lib/forms/SideSheet.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import { Field, FieldLabel, FieldContent } from "@/lib/components/ui/field.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { NativeSelect } from "@/lib/components/ui/native-select.jsx";
import { Textarea } from "@/lib/components/ui/textarea.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";
import { Button } from "@/lib/components/ui/button.jsx";

// ★★★ the maintainer, 1 Oct 2026 — FOUND LIVE: "there is no way to invite a new team member" tracked down to
//     this one line. `keystone.app_user.staff_role`'s real CHECK vocabulary is `member`, `admin`,
//     `owner` (src/people/vocab.mjs's own `STAFF_ROLES`) — there is no `"coach"` value in the
//     database at all. Every invite sent with the default role (Coach, the first option) hit
//     `POST /api/people/invite` and came back 400 "staff_role must be one of member, admin, owner
//     — got \"coach\"", every single time — which from the product's own screen looks exactly like
//     "nothing happens when I try to invite someone". `value` is now the real backend word; `label`
//     stays the product-facing one, same split `createPerson`'s own role/staffRole already keeps.
const ROLES = [
  {
    value: `member`,
    label: `Coach`,
    description: "Sees only their own clients and sessions. No money, no settings.",
  },
  {
    value: "admin",
    label: "Admin",
    description: "Runs the practice day to day: everyone's clients, money and settings except billing.",
  },
];

export default function TeamInviteDrawer({ seats = null, onCancel = null, onDone = null }) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [staffRole, setStaffRole] = useState(`member`);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [seatCapMessage, setSeatCapMessage] = useState(null);

  const firstName = useMemo(() => {
    const first = displayName.trim().split(/\s+/)[0];
    return first || "them";
  }, [displayName]);

  const roleDescription = useMemo(() => {
    return ROLES.find((r) => r.value === staffRole)?.description ?? "";
  }, [staffRole]);

  const used = useMemo(() => seats?.used ?? 0, [seats]);
  const limit = useMemo(() => seats?.limit ?? null, [seats]);

  const seatsConsequence = useMemo(() => {
    if (limit !== null) {
      return `You're using ${used} of ${limit}. This makes it ${used + 1}. After ${limit} it's $12 a month each.`;
    }
    return `You're using ${used}. This makes it ${used + 1}. There's no seat limit set yet.`;
  }, [used, limit]);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSeatCapMessage(null);
    try {
      await api.invitePerson({
        email: email.trim(),
        displayName: displayName.trim(),
        // ★★★ [TY, RULED 2 Oct 2026] EMAIL AND PHONE ARE BOTH REQUIRED FOR EVERY PERSON —
        //   createPerson (src/people/writes.mjs) now enforces this unconditionally, including a
        //   staff invite accepting into a real person record.
        phone: phone.trim(),
        staffRole,
        message: message.trim() || undefined,
      });
      onDone?.();
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        err.body?.error?.detail?.code === "seat_cap"
      ) {
        setSeatCapMessage(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
      }
      setBusy(false);
    }
  }

  const footerContent = (
    <footer className="sticky bottom-0 flex shrink-0 justify-end gap-2.5 border-t border-line bg-surface px-5.5 py-4">
      <Button
        type="button"
        variant="outline"
        data-testid="team-invite-cancel"
        onClick={() => onCancel?.()}
        disabled={busy}
      >
        Cancel
      </Button>
      {seatCapMessage ? (
        <a
          href="/settings/plans"
          className="inline-flex items-center justify-center gap-2 h-9 px-4 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-opacity"
          data-testid="team-invite-add-seat"
        >
          Add the seat
        </a>
      ) : (
        <Button
          type="submit"
          data-testid="team-invite-submit"
          disabled={busy}
        >
          {busy ? "Sending…" : "Send the invitation"}
        </Button>
      )}
    </footer>
  );

  return (
    <SideSheet
      title="Invite someone to the team"
      subtitle="They get an email with a link. It expires after seven days and uses a seat as soon as you send it."
      testId="team-invite"
      busy={busy}
      error={error}
      onCancel={() => onCancel?.()}
      onSave={submit}
      footer={footerContent}
    >
      <div className="flex flex-col">
        {seatCapMessage && (
          <div
            className="flex gap-2.5 items-start bg-bad-bg text-bad rounded-lg p-3 mb-3 text-sm leading-1.5"
            data-testid="team-invite-seat-cap"
            role="alert"
          >
            <span aria-hidden="true" className="flex-shrink-0">
              !
            </span>
            <span>{seatCapMessage}</span>
          </div>
        )}

        <div className="flex flex-col divide-y divide-line-soft">
          <Field orientation="horizontal" className="py-2.5">
            <FieldLabel htmlFor="team-invite-name">Name</FieldLabel>
            <FieldContent>
              <Input
                id="team-invite-name"
                data-testid="team-invite-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                maxLength="200"
                autoComplete="off"
                disabled={busy}
              />
            </FieldContent>
          </Field>

          <Field orientation="horizontal" className="py-2.5">
            <FieldLabel htmlFor="team-invite-email">Email</FieldLabel>
            <FieldContent>
              <Input
                id="team-invite-email"
                type="email"
                data-testid="team-invite-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                maxLength="320"
                autoComplete="off"
                disabled={busy}
              />
            </FieldContent>
          </Field>

          <Field orientation="horizontal" className="py-2.5">
            <FieldLabel htmlFor="team-invite-phone">Phone</FieldLabel>
            <FieldContent>
              <Input
                id="team-invite-phone"
                type="tel"
                data-testid="team-invite-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                maxLength="30"
                autoComplete="off"
                disabled={busy}
              />
            </FieldContent>
          </Field>

          <Field orientation="horizontal" className="py-2.5">
            <FieldLabel htmlFor="team-invite-role">What they can do</FieldLabel>
            <FieldContent>
              <NativeSelect
                id="team-invite-role"
                data-testid="team-invite-role"
                value={staffRole}
                onChange={(e) => setStaffRole(e.target.value)}
                disabled={busy}
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </NativeSelect>
              <p
                className="text-sm text-mute leading-1.5 mt-1.5"
                data-testid="team-invite-role-hint"
              >
                {roleDescription}
                <a
                  href="/settings/roles/presets"
                  className="ml-1 text-brand hover:underline"
                  data-testid="team-invite-role-link"
                >
                  What each role can do
                </a>
              </p>
            </FieldContent>
          </Field>

          <Field orientation="horizontal" className="py-2.5">
            <FieldLabel htmlFor="team-invite-locations">Which locations</FieldLabel>
            <FieldContent>
              <DisabledWithReason
                disabled
                reason="Where someone works is set on their shifts, in Scheduling."
                testId="team-invite-locations"
              >
                {({ disabled, describedBy }) => (
                  <NativeSelect
                    id="team-invite-locations"
                    data-testid="team-invite-locations-select"
                    disabled={disabled}
                    aria-describedby={describedBy}
                  >
                    <option>Set on their shifts</option>
                  </NativeSelect>
                )}
              </DisabledWithReason>
            </FieldContent>
          </Field>

          <Field orientation="horizontal" className="py-2.5">
            <FieldLabel htmlFor="team-invite-message">A line from you</FieldLabel>
            <FieldContent>
              <Textarea
                id="team-invite-message"
                data-testid="team-invite-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength="500"
                rows={3}
                disabled={busy}
                placeholder="Hi Dana — here's your login for the booking system."
              />
              <div className="mt-2">
                <DisabledWithReason
                  disabled
                  reason="AI drafting isn't built yet."
                  testId="team-invite-ai"
                >
                  {({ disabled, describedBy }) => (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={disabled}
                      aria-describedby={describedBy}
                      data-testid="team-invite-ai-button"
                    >
                      Write with AI
                    </Button>
                  )}
                </DisabledWithReason>
              </div>
            </FieldContent>
          </Field>

          <Field orientation="horizontal" className="py-2.5">
            <FieldLabel htmlFor="team-invite-scope">Let them see everyone's clients</FieldLabel>
            <FieldContent>
              <DisabledWithReason
                disabled
                reason="Set by role, under Who can do what."
                testId="team-invite-scope"
              >
                {({ disabled, describedBy }) => (
                  <Switch
                    id="team-invite-scope"
                    checked={false}
                    disabled={disabled}
                    aria-describedby={describedBy}
                    data-testid="team-invite-scope-toggle"
                  />
                )}
              </DisabledWithReason>
            </FieldContent>
          </Field>

          <Field orientation="horizontal" className="py-2.5">
            <FieldLabel htmlFor="team-invite-starting-clients">Clients to start with (optional)</FieldLabel>
            <FieldContent>
              <DisabledWithReason
                disabled
                reason="Assign clients after they accept."
                testId="team-invite-starting-clients"
              >
                {({ disabled, describedBy }) => (
                  <NativeSelect
                    id="team-invite-starting-clients"
                    data-testid="team-invite-starting-clients-select"
                    disabled={disabled}
                    aria-describedby={describedBy}
                  >
                    <option>None yet — assign later</option>
                  </NativeSelect>
                )}
              </DisabledWithReason>
            </FieldContent>
          </Field>
        </div>

        <div
          className="bg-brand-soft rounded-lg p-3 my-3 text-sm leading-1.5 text-accent-foreground"
          data-testid="team-invite-seats-banner"
        >
          <b>Seats.</b> {seatsConsequence}
        </div>

        <div className="mt-1">
          <DisabledWithReason disabled reason="No preview yet." testId="team-invite-preview">
            {({ disabled, describedBy }) => (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                aria-describedby={describedBy}
                data-testid="team-invite-preview-button"
              >
                Preview email
              </Button>
            )}
          </DisabledWithReason>
        </div>

        <p
          className="text-sm text-mute leading-1.5 mt-3"
          data-testid="team-invite-expiry-note"
        >
          {firstName} gets an email to set a password. The invite expires in 7 days.
        </p>
      </div>
    </SideSheet>
  );
}
