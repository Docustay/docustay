// ═══════════════════════════════════════════════════════════════════════════════════════════════
// SubscriptionActions — P3.U5 (W2). The subscription record's header actions: chip, Pause/Resume,
// Update card, Cancel, Remove discount, Preview next invoice. No Svelte source: behaviour comes from
// the WIRING-MAP §3.3/§3.4 rows for these testids (each frame's own "What every control on this
// frame does" block, quoted there) and PHASE-3.md's rules for P3.U5 (W2).
//
// Ported from specs/mockups/SubscriptionActions.frame.html (active), SubscriptionPaused.frame.html
// (paused) and MoneyCancel.frame.html (the cancel confirmation) — structure, order, labels and every
// text run those three draw. The h1 (client — plan) and the record's kv card are the HOST SCREEN's
// own render (its R-wave task, PHASE-3.md field 10); this component is only the actions row those
// frames draw beside it.
//
// Menu contents by subscription.status (PHASE-3.md field 4):
//   active    → Pause, Update card, Cancel [+ Remove discount if a discount is attached]
//   paused    → Resume now (primary) + Cancel
//   cancelled → nothing but the preview
//
// ★★★ NO stripe_subscription_id → EVERY STRIPE ACTION DISABLED, including the preview (the WIRING-MAP
//     row: "Preview next invoice … → Stripe POST /invoices/create_preview" — it calls Stripe too).
//     A missing PREREQUISITE renders disabled with the reason (never hidden — the maintainer's rule); a missing
//     PERMISSION renders nothing (useWrite's `hidden`, WriteButton, and this file's own `ActionItem`).
// ★ `subscription` — supplied by the host screen's record read, never invented here:
//   { id, appUserId, clientName, planName, status: 'active'|'paused'|'cancelled', chipLabel,
//     stripeSubscriptionId, discount: {label}|null,
//     cancelCopy: { title, subtitle, periodEndConsequence, nowConsequence, pauseConsequence, note,
//                   periodEndDate } | null }
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { Ellipsis } from "lucide-react";
import { Button } from "@/lib/components/ui/button.jsx";
import { RadioGroup, RadioGroupItem } from "@/lib/components/ui/radio-group.jsx";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/lib/components/ui/dropdown-menu.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import DatePicker from "@/lib/components/kit/DatePicker.jsx";
import SheetRow from "@/lib/components/kit/SheetRow.jsx";
import ActionSurface from "@/lib/forms/ActionSurface.jsx";
import DecisionModal from "@/lib/forms/DecisionModal.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import WriteButton from "@/lib/permissions/WriteButton.jsx";
import { useWrite } from "@/lib/permissions/useWrite.js";
import { api } from "@/lib/api.js";
import { ICON_STROKE } from "@/lib/empty/icons.js";

const CHARGES_OFF_REASON = "Connect Stripe first — Settings › Money.";
const CHIP_TONE = { active: "ok", paused: "warn", cancelled: "neutral" };

/** write.error is an ApiError — the server's own message, plus its request id. */
function writeErrorNode(error) {
  if (!error) return null;
  return (
    <>
      {error.message}
      {error.requestId && (
        <>
          <br />
          <span className="text-meta text-mute">Reference {error.requestId} — nothing changed.</span>
        </>
      )}
    </>
  );
}

/** One menu row: hidden → nothing; blocked → disabled with its reason; else the active item. */
function ActionItem({ testId, label, write, onSelect, destructive = false }) {
  if (write.hidden) return null;
  if (write.blocked) {
    return (
      <DisabledWithReason disabled reason={write.blocked.reason} testId={`${testId}-blocked`}>
        {({ describedBy }) => (
          <DropdownMenuItem data-testid={testId} disabled aria-describedby={describedBy} onSelect={(e) => e.preventDefault()}>
            {label}
          </DropdownMenuItem>
        )}
      </DisabledWithReason>
    );
  }
  return (
    <DropdownMenuItem data-testid={testId} variant={destructive ? "destructive" : "default"} onSelect={onSelect}>
      {label}
    </DropdownMenuItem>
  );
}

export default function SubscriptionActions({ subscription, onChanged }) {
  // ★ Hooks run unconditionally (Rules of Hooks) even while `subscription` has not loaded yet — the
  //   loading render below is chosen AFTER every useWrite has been called, never before.
  const ownerId = subscription?.appUserId ?? null;
  const chargesOff = !subscription?.stripeSubscriptionId;
  const blockedReason = chargesOff ? CHARGES_OFF_REASON : null;

  const pause = useWrite("pauseSubscription", { ownerId, blockedReason });
  const resume = useWrite("resumeSubscription", { ownerId, blockedReason });
  const updateCard = useWrite("updateSubscriptionCard", { ownerId, blockedReason });
  const stop = useWrite("stopSubscription", { ownerId, blockedReason });
  const removeDiscount = useWrite("removeSubscriptionDiscount", { ownerId, blockedReason });

  const [pauseOpen, setPauseOpen] = useState(false);
  const [resumesAt, setResumesAt] = useState(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelChoice, setCancelChoice] = useState("period_end");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [previewData, setPreviewData] = useState(null);

  if (!subscription) {
    return (
      <div className="flex items-center gap-2" data-testid="subscription-actions" aria-busy="true">
        <Button variant="ghost" size="icon-sm" disabled aria-busy="true" data-testid="subscription-actions-menu" aria-label="Subscription actions">
          <Ellipsis strokeWidth={ICON_STROKE} aria-hidden="true" />
        </Button>
      </div>
    );
  }

  const status = subscription.status;
  const copy = {
    title: subscription.cancelCopy?.title ?? `Stop ${subscription.clientName}'s ${subscription.planName}?`,
    subtitle: subscription.cancelCopy?.subtitle ?? null,
    periodEndConsequence: subscription.cancelCopy?.periodEndConsequence
      ?? "Stops at the end of the current billing period. Nothing more is taken.",
    nowConsequence: subscription.cancelCopy?.nowConsequence
      ?? "Stops right now. Any unused portion may be refunded.",
    pauseConsequence: subscription.cancelCopy?.pauseConsequence
      ?? "Pauses instead of cancelling. Nothing is charged while paused.",
    note: subscription.cancelCopy?.note ?? null,
    periodEndDate: subscription.cancelCopy?.periodEndDate ?? null,
  };

  const inlineError = resume.error || updateCard.error || removeDiscount.error;

  async function runResume() {
    await resume.run({ subscriptionId: subscription.id });
    onChanged?.();
  }
  async function runUpdateCard() {
    await updateCard.run({ subscriptionId: subscription.id });
    onChanged?.();
  }
  async function runRemoveDiscount() {
    await removeDiscount.run({ subscriptionId: subscription.id });
    onChanged?.();
  }
  async function confirmPause(e) {
    e?.preventDefault?.();
    try {
      await pause.run({ subscriptionId: subscription.id, resumesAt });
      setPauseOpen(false);
      onChanged?.();
    } catch {
      // pause.error renders inline below — the surface stays open.
    }
  }
  async function confirmCancel() {
    if (cancelChoice === "pause") {
      setCancelOpen(false);
      setPauseOpen(true);
      return;
    }
    try {
      await stop.run({ subscriptionId: subscription.id, when: cancelChoice });
      setCancelOpen(false);
      onChanged?.();
    } catch {
      // stop.error renders inline below — the surface stays open.
    }
  }
  async function doPreview() {
    if (chargesOff) return;
    setPreviewOpen(true);
    setPreviewBusy(true);
    setPreviewError(null);
    try {
      const data = await api.previewSubscriptionInvoice({ subscriptionId: subscription.id });
      setPreviewData(data);
    } catch (err) {
      setPreviewError(err);
    } finally {
      setPreviewBusy(false);
    }
  }

  const showUpdateCard = status === "active";
  const showRemoveDiscount = status === "active" && !!subscription.discount;
  const showCancelItem = status !== "cancelled";
  const hasMenu = status === "active" && (!updateCard.hidden || (showRemoveDiscount && !removeDiscount.hidden) || !stop.hidden);

  const confirmLabel = cancelChoice === "now"
    ? "Stop now"
    : cancelChoice === "pause"
      ? "Pause it instead"
      : copy.periodEndDate ? `Stop on ${copy.periodEndDate}` : "Stop at the end of the period";

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="subscription-actions">
      <StatusBadge testId="subscription-status" tone={CHIP_TONE[status] ?? "neutral"} label={subscription.chipLabel} />

      {status === "active" && (
        <WriteButton write={pause} variant="outline" testId="subscription-action-pause" onClick={() => setPauseOpen(true)}>
          Pause
        </WriteButton>
      )}

      {status === "paused" && (
        <WriteButton write={resume} variant="default" testId="subscription-action-resume" onClick={runResume}>
          Resume now
        </WriteButton>
      )}

      <DisabledWithReason disabled={chargesOff} reason={CHARGES_OFF_REASON} testId="subscription-preview-invoice-blocked">
        {({ describedBy }) => (
          <Button variant="outline" data-testid="subscription-preview-invoice" disabled={chargesOff || previewBusy}
                  aria-describedby={chargesOff ? describedBy : undefined} onClick={doPreview}>
            Preview next invoice
          </Button>
        )}
      </DisabledWithReason>

      {status === "paused" && !stop.hidden && (
        <WriteButton write={stop} variant="outline" testId="subscription-action-cancel" onClick={() => setCancelOpen(true)}>
          Cancel
        </WriteButton>
      )}

      {hasMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" data-testid="subscription-actions-menu" aria-label="More actions">
              <Ellipsis strokeWidth={ICON_STROKE} aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {showUpdateCard && (
              <ActionItem testId="subscription-action-update-card" label="Update card" write={updateCard} onSelect={runUpdateCard} />
            )}
            {showRemoveDiscount && (
              <ActionItem testId="subscription-remove-discount" label="Remove discount" write={removeDiscount} onSelect={runRemoveDiscount} />
            )}
            {(showUpdateCard || showRemoveDiscount) && showCancelItem && !stop.hidden && <DropdownMenuSeparator />}
            {showCancelItem && (
              <ActionItem testId="subscription-action-cancel" label="Cancel subscription" write={stop} destructive
                          onSelect={() => setCancelOpen(true)} />
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {inlineError && <ErrorPanel error={inlineError} subject="This action" testId="subscription-actions-error" />}

      {pauseOpen && (
        <ActionSurface kind="dialog" title="Pause the subscription" testId="subscription-pause"
                        busy={pause.busy} error={writeErrorNode(pause.error)} submitLabel="Pause subscription"
                        submitDisabled={!resumesAt} onCancel={() => setPauseOpen(false)} onSubmit={confirmPause}>
          <SheetRow label="Resume on" htmlFor="subscription-pause-resume-date" required>
            <DatePicker id="subscription-pause-resume-date" testId="subscription-pause-resume-date"
                        value={resumesAt} onValueChange={setResumesAt} />
          </SheetRow>
        </ActionSurface>
      )}

      {cancelOpen && (
        <DecisionModal open onOpenChange={setCancelOpen} title={copy.title} subtitle={copy.subtitle}
                        cancelLabel="Leave it running" confirmLabel={confirmLabel} busy={stop.busy}
                        error={writeErrorNode(stop.error)} onCancel={() => setCancelOpen(false)} onConfirm={confirmCancel}
                        testId="subscription-cancel">
          <RadioGroup className="flex flex-col gap-2.5" value={cancelChoice} onValueChange={setCancelChoice}>
            <label className="flex cursor-pointer gap-3.5 rounded-option border border-line p-3.5 has-[[data-state=checked]]:border-brand has-[[data-state=checked]]:bg-brand-soft"
                   data-testid="subscription-cancel-period-end" data-selected={cancelChoice === "period_end" ? "true" : undefined}>
              <RadioGroupItem value="period_end" className="mt-0.5" />
              <span className="flex flex-col">
                <b className="text-field font-medium text-ink">At the end of what he’s paid for</b>
                <span className="mt-1 text-meta leading-relaxed text-mute">{copy.periodEndConsequence}</span>
              </span>
            </label>
            <label className="flex cursor-pointer gap-3.5 rounded-option border border-line p-3.5 has-[[data-state=checked]]:border-brand has-[[data-state=checked]]:bg-brand-soft"
                   data-testid="subscription-cancel-now" data-selected={cancelChoice === "now" ? "true" : undefined}>
              <RadioGroupItem value="now" className="mt-0.5" />
              <span className="flex flex-col">
                <b className="text-field font-medium text-ink">Right now, and refund the rest</b>
                <span className="mt-1 text-meta leading-relaxed text-mute">{copy.nowConsequence}</span>
              </span>
            </label>
            <label className="flex cursor-pointer gap-3.5 rounded-option border border-line p-3.5 has-[[data-state=checked]]:border-brand has-[[data-state=checked]]:bg-brand-soft"
                   data-testid="subscription-cancel-pause-instead" data-selected={cancelChoice === "pause" ? "true" : undefined}>
              <RadioGroupItem value="pause" className="mt-0.5" />
              <span className="flex flex-col">
                <b className="text-field font-medium text-ink">Pause it instead</b>
                <span className="mt-1 text-meta leading-relaxed text-mute">{copy.pauseConsequence}</span>
              </span>
            </label>
          </RadioGroup>
          {copy.note && (
            <div className="mt-3 rounded-sm bg-brand-soft px-3.5 py-3 text-meta leading-relaxed text-ink-2" data-testid="subscription-cancel-note">
              <b className="font-medium">Either way.</b> {copy.note}
            </div>
          )}
        </DecisionModal>
      )}

      {previewOpen && (
        <ActionSurface kind="confirm" title="Next invoice" testId="subscription-preview-invoice-panel"
                        busy={false} error={previewError ? writeErrorNode(previewError) : null} cancelLabel={null}
                        submitLabel="Close" onCancel={() => setPreviewOpen(false)} onSubmit={() => setPreviewOpen(false)}>
          {previewBusy ? (
            <p className="m-0 text-ui text-mute" data-testid="subscription-preview-invoice-loading">Loading the next invoice…</p>
          ) : previewData ? (
            <div className="flex flex-col gap-3" data-testid="subscription-preview-invoice-body">
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {(previewData.lines ?? []).map((line, i) => (
                  <li key={i} className="flex justify-between text-ui text-ink" data-testid={`subscription-preview-invoice-line-${i}`}>
                    <span>{line.description}</span>
                    <span className="tabular-nums">{line.amountLabel}</span>
                  </li>
                ))}
              </ul>
              {previewData.prorationLabel && (
                <p className="m-0 text-meta text-mute" data-testid="subscription-preview-invoice-proration">{previewData.prorationLabel}</p>
              )}
              {previewData.dateLabel && (
                <p className="m-0 text-meta text-mute" data-testid="subscription-preview-invoice-date">{previewData.dateLabel}</p>
              )}
            </div>
          ) : null}
        </ActionSurface>
      )}
    </div>
  );
}
