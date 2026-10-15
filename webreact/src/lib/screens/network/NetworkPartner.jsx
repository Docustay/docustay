// ═══════════════════════════════════════════════════════════════════════════════════════════════
// NetworkPartner — NETWORK PARTNER RECORD (`/network/{id}`, F04 §2.2). Ported from
// webui/src/lib/screens/network/NetworkPartner.svelte (same props, testids, copy).
// Data is PRE-FETCHED by Screen.svelte's route matcher, not self-fetched here.
// Layout from the frame; behaviour from the Svelte source. Styling: Tailwind + tokens.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useContext } from "react";
import { api, ApiError } from "@/lib/api.js";
import { Badge } from "@/lib/components/ui/badge.jsx";
import { NativeSelect } from "@/lib/components/ui/native-select.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import NetworkReferOut from "./NetworkReferOut.jsx";
import { toast } from "sonner";
import { DeleteButton } from "@/lib/record/DeleteDialog.jsx";
import { AppStateContext } from "@/lib/app/useAppState.js";

export default function NetworkPartner({ data = null, onNavigate = null, onDone = null }) {
  const app = useContext(AppStateContext);
  const [outcomeOverrides, setOutcomeOverrides] = useState({});
  const [outcomeBusyId, setOutcomeBusyId] = useState(null);
  const [referOpen, setReferOpen] = useState(false);

  const party = data?.party ?? null;
  const between = data?.between ?? {};
  const showsTeamRow = data?.showsTeamRow === true;

  const recent = (data?.recent ?? []).map((r) =>
    outcomeOverrides[r.id] ? { ...r, outcome: outcomeOverrides[r.id] } : r);

  function go(href) {
    if (onNavigate) onNavigate(href);
    else window.location.assign(href);
  }

  function initials(name) {
    const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase().replace(/[^A-Z0-9]/g, "") || "?";
  }

  function relationWords(b) {
    const theySent = b?.theySent ?? 0;
    const youSent = b?.youSent ?? 0;
    if (theySent > 0 && youSent > 0) return "both ways";
    if (theySent > 0) return "from them";
    if (youSent > 0) return "to them";
    return null;
  }

  function getHeaderLine() {
    if (!party) return "";
    const parts = [];
    if (party.whatTheyDo) parts.push(party.whatTheyDo);
    if (party.city) parts.push(party.city);
    if (party.contact?.name) parts.push(party.contact.name);
    const since = party.since ? new Date(party.since).toLocaleDateString("en-US", { month: "long" }) : null;
    const words = relationWords(between);
    if (since) {
      parts.push(words ? `referring ${words} since ${since}` : `known since ${since}`);
    }
    return parts.join(" · ");
  }

  function directionLine(r) {
    const who = r.person?.name ?? "someone";
    return r.direction === "out" ? `You sent ${who}` : `They sent ${who}`;
  }

  const OUTCOME_LABEL = {
    sent: "Sent",
    taken: "Taken",
    in_progress: "In progress",
    became_client: "Now a client",
    declined: "Declined",
    no_reply: "No reply"
  };

  const OUTCOME_TONE = {
    sent: "act",
    taken: "ok",
    in_progress: "act",
    became_client: "ok",
    declined: "bad",
    no_reply: "warn"
  };

  const REFERRAL_OUTCOMES = ["sent", "taken", "in_progress", "became_client", "declined", "no_reply"];

  async function setOutcome(row, outcome) {
    if (outcome === row.outcome || outcomeBusyId) return;
    setOutcomeBusyId(row.id);
    try {
      await api.setReferralOutcome(row.id, { outcome });
      setOutcomeOverrides((prev) => ({ ...prev, [row.id]: outcome }));
      onDone?.();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setOutcomeBusyId(null);
    }
  }

  function openRefer() { setReferOpen(true); }
  function closeRefer() { setReferOpen(false); }
  function doneRefer() { setReferOpen(false); onDone?.(); }

  if (!party) return null;

  const getChipClasses = (tone) => {
    const toneMap = {
      ok: "bg-success-50 text-success-700",
      warn: "bg-warning-50 text-warning-700",
      bad: "bg-danger-50 text-danger-700",
      act: "bg-action-50 text-action-600",
      neutral: "bg-chip-neutral-bg text-chip-neutral-ink"
    };
    return toneMap[tone] || toneMap.neutral;
  };

  return (
    <>
      <div className="flex items-start gap-4 mb-5" data-testid="network-partner-header">
        <span
          className="flex size-14 shrink-0 items-center justify-center rounded-pill bg-primary-wash text-heading font-medium text-primary"
          aria-hidden="true"
        >
          {initials(party.name)}
        </span>
        <span className="flex-1 min-w-0">
          <h1 className="m-0 text-page-title font-medium text-ink" data-testid="network-partner-name">
            {party.name}
          </h1>
          <div className="text-meta text-mute mt-1.5" data-testid="network-partner-meta">
            {getHeaderLine()}
          </div>
        </span>
        <DisabledWithReason
          disabled={!party.email}
          reason="No email on file for this practice."
          testId="network-partner-message"
        >
          {({ disabled, describedBy }) => (
            <a
              className="inline-flex h-9 items-center rounded-control border border-line bg-surface px-[17px] text-ui font-medium text-ink-2 hover:bg-paper hover:text-ink disabled:opacity-50"
              href={party.email ? `mailto:${party.email}` : undefined}
              aria-disabled={disabled}
              aria-describedby={describedBy}
              data-testid="network-partner-message-link"
              onClick={(e) => { if (disabled) e.preventDefault(); }}
            >
              Message
            </a>
          )}
        </DisabledWithReason>
        <Button variant="default" onClick={openRefer} data-testid="network-partner-refer">
          Refer someone
        </Button>
        <DeleteButton type="network_party" id={party.id} label={party.name ?? null} rank={app?.nav?.rank ?? null}
          onDone={() => go("/network")} />
      </div>

      <div className="flex gap-5 items-start">
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          <div className="bg-surface border border-line rounded-lg">
            <div className="px-[17px] py-3.5 border-b border-hair text-ui font-medium text-ink">
              <b>Between you</b>
            </div>
            <div className="px-[17px] pb-3.5 pt-1.5 flex flex-wrap gap-0" data-testid="network-partner-nums">
              <div className="flex-1 basis-1/3 py-3.25 border-b border-hair">
                <div className="text-heading font-normal text-ink-2 tabular-nums">
                  {between.theySent ?? 0}
                </div>
                <div className="text-meta text-mute mt-0.5">they sent you</div>
              </div>
              <div className="flex-1 basis-1/3 py-3.25 border-b border-hair">
                <div className="text-heading font-normal text-ink-2 tabular-nums">
                  {between.youSent ?? 0}
                </div>
                <div className="text-meta text-mute mt-0.5">you sent them</div>
              </div>
              <div className="flex-1 basis-1/3 py-3.25 border-b border-hair">
                <div className="text-heading font-normal text-ink-2 tabular-nums">
                  {between.becameClients ?? 0}
                </div>
                <div className="text-meta text-mute mt-0.5">became clients</div>
              </div>
              {between.spentMinor !== undefined && (
                <div className="flex-1 basis-1/3 py-3.25 border-b border-hair" data-testid="network-partner-spent">
                  <div className="text-heading font-normal text-ink-2 tabular-nums">
                    {new Intl.NumberFormat("en-US", {
                      style: "currency",
                      currency: between.currency ?? "USD"
                    }).format((between.spentMinor ?? 0) / 100)}
                  </div>
                  <div className="text-meta text-mute mt-0.5">those three have spent</div>
                </div>
              )}
            </div>
          </div>

          <div className="bg-surface border border-line rounded-lg">
            <div className="px-[17px] py-3.5 border-b border-hair text-ui font-medium text-ink">
              <b>Recently</b>
            </div>
            <div className="px-[17px] pt-1.5 pb-3.5 flex flex-col gap-0" data-testid="network-partner-recent">
              {recent.length === 0 ? (
                <p className="text-meta text-mute my-2" data-testid="network-partner-recent-empty">
                  Nothing yet.
                </p>
              ) : (
                recent.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center gap-3 py-2.75 border-b border-hair last:border-b-0 text-ui"
                    data-testid={`network-partner-recent-${r.id}`}
                  >
                    <span className="w-[74px] shrink-0 text-meta text-mute font-normal tabular-nums">
                      {r.date ? new Date(r.date).toLocaleDateString() : "—"}
                    </span>
                    <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                      <span className="text-ui text-ink">
                        {directionLine(r)}
                        {r.reason && <span> {r.reason}</span>}
                      </span>
                    </span>
                    <NativeSelect
                      value={r.outcome}
                      disabled={outcomeBusyId === r.id}
                      data-testid={`network-partner-outcome-${r.id}`}
                      onChange={(e) => setOutcome(r, e.currentTarget.value)}
                      className="shrink-0"
                      size="sm"
                    >
                      {REFERRAL_OUTCOMES.map((o) => (
                        <option key={o} value={o}>
                          {OUTCOME_LABEL[o]}
                        </option>
                      ))}
                    </NativeSelect>
                    <Badge
                      className={`shrink-0 ${getChipClasses(OUTCOME_TONE[r.outcome])}`}
                    >
                      {OUTCOME_LABEL[r.outcome] ?? r.outcome}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="w-80 shrink-0">
          <div className="bg-surface border border-line rounded-lg">
            <div className="px-[17px] py-3.5 border-b border-hair text-ui font-medium text-ink">
              <b>How this works</b>
            </div>
            <div className="px-[17px] pt-1.5 pb-3.5 flex flex-col gap-0">
              <div className="flex items-start gap-3 py-2.75 border-b border-hair text-ui">
                <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <b className="text-ink">You send a name and a reason</b>
                  <span className="text-meta text-mute">Nothing else. No notes, no history, no records.</span>
                </span>
              </div>
              <div className="flex items-start gap-3 py-2.75 border-b border-hair text-ui">
                <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <b className="text-ink">The person is told</b>
                  <span className="text-meta text-mute">By you, before you send anything. Referring someone without telling them is not on.</span>
                </span>
              </div>
              {showsTeamRow && (
                <div className="flex items-start gap-3 py-2.75 border-b border-hair text-ui" data-testid="network-partner-team-row">
                  <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <b className="text-ink">{party.contact?.name ?? "They"} is also on your team</b>
                    <span className="text-meta text-mute">Separate thing entirely. They give sessions here; {party.name} is their own business.</span>
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {referOpen && (
        <NetworkReferOut
          open={true}
          partyId={party.id}
          partyName={party.name}
          onCancel={closeRefer}
          onDone={doneRefer}
        />
      )}
    </>
  );
}
