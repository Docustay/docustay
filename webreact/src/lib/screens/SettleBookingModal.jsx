// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BOOKING OVERHAUL, 29 Sep 2026 — THE HELD/NO-SHOW CONFIRMATION MODAL.
//
// the maintainer's own words: "when you click the held button, it means that it should give option to charge
// card on file or prep an invoice with all the information from the booking like all of it...
// ensure it is in sync with the charge credit logic for people who have packages... these options
// need an explicit confirmation button that says by clicking this button you are agreeing to charge
// Joe X amount of money." This is that modal — for BOTH "Held" (completed, 100%) and "No-show" (the
// practice's own ruled percentage), the same component, driven by `outcome`.
//
// ★★ THE AMOUNT SHOWN IS THE AMOUNT CHARGED. `api.settlePreview` and `api.settleBooking` both read
//    through `src/booking/settleBooking.mjs`'s ONE percent/amount computation — this modal never
//    computes a dollar figure itself.
// ★★ A RESERVED PACKAGE CREDIT IS NOT A CHOICE — it already paid for this session (see
//    settleBooking.mjs's own header). The modal says so and offers one button, no payment picker.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api.js";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/lib/components/ui/dialog.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { RadioGroup, RadioGroupItem } from "@/lib/components/ui/radio-group.jsx";
import { Skeleton } from "@/lib/components/ui/skeleton.jsx";

const OUTCOME_LABEL = { completed: "Held", no_show: "No-show" };

function formatMoney(amountMinor, currency) {
  if (amountMinor == null) return null;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" })
    .format(amountMinor / 100);
}

export default function SettleBookingModal({
  open = false, onOpenChange = null, bookingId = null, outcome = null,
  participants = [], onSettled = null,
}) {
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [method, setMethod] = useState("card");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  // ★ Part 4/5 (saved-card brief, 1 Oct 2026) — "tell staff plainly" when a card charge fell back
  //   to an invoice. Holding the result here instead of closing immediately is what makes that
  //   message something staff actually reads, not something that flashes by.
  const [fallbackResult, setFallbackResult] = useState(null);

  useEffect(() => {
    if (!open || !bookingId || !outcome) return undefined;
    let live = true;
    setLoading(true);
    setPreview(null);
    setPreviewError(null);
    setProblem(null);
    (async () => {
      try {
        const p = await api.settlePreview({ bookingId, outcome });
        if (!live) return;
        setPreview(p);
        // ★ Part 5 (saved-card brief, 1 Oct 2026) — the maintainer's exact order: credit, then card on file,
        //   then invoice, then don't charge. Default to the first one actually AVAILABLE — a card
        //   charge is never the default when there is no card to charge.
        setMethod(p.alreadyCreditReserved ? "credit"
          : p.hasSpendableCredit ? "credit"
          : !p.billable ? "none"
          : p.hasCardOnFile ? "card"
          : "invoice");
      } catch (err) {
        if (live) setPreviewError(err instanceof ApiError ? err.message : String(err?.message ?? err));
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [open, bookingId, outcome]);

  const amount = preview ? formatMoney(preview.amountMinor, preview.currency) : null;
  const name = preview?.clientName || "the client";
  const outcomeLabel = OUTCOME_LABEL[outcome] ?? outcome;

  function confirmSentence() {
    // ★ FOUND LIVE, 29 Sep 2026 — Radix Dialog keeps rendering its children for a moment while it
    //   animates closed, and `settled()` (AttendanceControl.jsx) clears `pendingOutcome` to null in
    //   that same tick. `outcomeLabel` then has nothing to look up and `.toLowerCase()` below crashed
    //   the whole record page with "Cannot read properties of null" — caught by actually clicking
    //   Confirm, not by reading the code. Guarding on `outcome` itself (not just `preview`) is what
    //   this needs: `preview` can still be the stale, non-null object from before the click.
    if (!preview || !outcome) return null;
    if (preview.alreadyCreditReserved) {
      return `A session credit already reserved for this booking will be used — nothing else is charged.`;
    }
    // ★ CREDITS defect 11 — a spendable credit pays for a session that has no price recorded.
    const creditOnly = !preview.billable && preview.hasSpendableCredit && preview.clientId;
    if (creditOnly && method === "credit") {
      return `By clicking this button, you are agreeing to use one of ${name}'s session credits for this ${outcomeLabel.toLowerCase()} session.`;
    }
    if (!preview.billable && !creditOnly) {
      return `This session will be recorded as ${outcomeLabel.toLowerCase()}. ${preview.reason === "no client on this session" ? "There is no client on this session to bill." : "There is no price recorded for this session, so nothing can be charged."}`;
    }
    if (method === "credit") {
      return `By clicking this button, you are agreeing to use one of ${name}'s session credits for this ${outcomeLabel.toLowerCase()} session.`;
    }
    if (!preview.billable) {
      return `By clicking this button, you are recording this session as ${outcomeLabel.toLowerCase()} with no charge.`;
    }
    if (method === "card") {
      return `By clicking this button, you are agreeing to charge ${name} ${amount} on the card on file.`;
    }
    if (method === "invoice") {
      return `By clicking this button, you are agreeing to send ${name} an invoice for ${amount}.`;
    }
    return `By clicking this button, you are recording this session as ${outcomeLabel.toLowerCase()} with no charge.`;
  }

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const effectiveMethod = preview?.alreadyCreditReserved ? "none"
        : preview?.billable ? method
        : (preview?.hasSpendableCredit && preview?.clientId && method === "credit") ? "credit" : "none";
      const result = await api.settleBooking({
        bookingId, outcome, participants, paymentMethod: effectiveMethod,
      });
      if (result?.payment?.staff_message) {
        // Stay open — see fallbackResult's own note above.
        setFallbackResult(result);
      } else {
        onSettled?.(result);
        onOpenChange?.(false);
      }
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  function acknowledgeFallback() {
    onSettled?.(fallbackResult);
    setFallbackResult(null);
    onOpenChange?.(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="settle-booking-modal" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{outcomeLabel === "Held" ? "Mark session held" : "Mark as no-show"}</DialogTitle>
          <DialogDescription>
            {preview?.serviceName ? `${preview.serviceName} — ${name}` : name}
          </DialogDescription>
        </DialogHeader>

        {fallbackResult ? (
          // ★ Part 4/5 — plain words, never the developer-facing refusal text (see
          //   settleBooking.mjs's own note on this exact sentence).
          <p className="text-sm text-ink" role="status" data-testid="settle-fallback-message">
            {fallbackResult.payment.staff_message}
          </p>
        ) : loading ? (
          <div className="flex flex-col gap-2" data-testid="settle-loading">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-3/4" />
          </div>
        ) : previewError ? (
          <p className="text-sm text-bad" role="alert" data-testid="settle-preview-error">{previewError}</p>
        ) : preview ? (
          <div className="flex flex-col gap-3" data-testid="settle-body">
            {preview.alreadyCreditReserved ? (
              <p className="text-sm text-ink" data-testid="settle-credit-reserved">
                A session credit was already set aside for this booking. Confirming will use it — nothing else is charged.
              </p>
            ) : !preview.billable && preview.hasSpendableCredit && preview.clientId ? (
              <>
                <p className="text-sm text-ink-muted" data-testid="settle-not-billable">
                  This session has no price recorded, but {name} has a session credit.
                </p>
                <RadioGroup value={method} onValueChange={setMethod} data-testid="settle-method-group">
                  <label className="flex items-center gap-2 text-sm text-ink" data-testid="settle-method-credit">
                    <RadioGroupItem value="credit" data-testid="settle-method-credit-radio" />
                    Use a session credit — {preview.creditRemaining} of {preview.creditTotal} left
                  </label>
                  <label className="flex items-center gap-2 text-sm text-ink" data-testid="settle-method-none">
                    <RadioGroupItem value="none" data-testid="settle-method-none-radio" />
                    Don't charge anything
                  </label>
                </RadioGroup>
              </>
            ) : !preview.billable ? (
              <p className="text-sm text-ink-muted" data-testid="settle-not-billable">
                {preview.reason === "no client on this session"
                  ? "There is no client on this session, so nothing can be charged."
                  : "This session has no price recorded, so nothing can be charged."}
              </p>
            ) : (
              <>
                <p className="text-sm text-ink-muted">
                  {outcome === "no_show"
                    ? `${preview.percent}% no-show charge`
                    : "Full session charge"} — <b className="text-ink">{amount}</b>
                </p>
                <RadioGroup value={method} onValueChange={setMethod} data-testid="settle-method-group">
                  {preview.hasSpendableCredit && (
                    <label className="flex items-center gap-2 text-sm text-ink" data-testid="settle-method-credit">
                      <RadioGroupItem value="credit" data-testid="settle-method-credit-radio" />
                      Use a session credit — {preview.creditRemaining} of {preview.creditTotal} left
                    </label>
                  )}
                  <label
                    className={`flex items-center gap-2 text-sm ${preview.hasCardOnFile ? "text-ink" : "text-ink-muted"}`}
                    data-testid="settle-method-card"
                  >
                    <RadioGroupItem value="card" disabled={!preview.hasCardOnFile} data-testid="settle-method-card-radio" />
                    {preview.hasCardOnFile
                      ? `Charge ${preview.card.brand ? `${preview.card.brand} ` : ""}•••• ${preview.card.lastFour}`
                      : "Charge the card on file — No card on file"}
                  </label>
                  <label className="flex items-center gap-2 text-sm text-ink" data-testid="settle-method-invoice">
                    <RadioGroupItem value="invoice" data-testid="settle-method-invoice-radio" />
                    Send an invoice
                  </label>
                  <label className="flex items-center gap-2 text-sm text-ink" data-testid="settle-method-none">
                    <RadioGroupItem value="none" data-testid="settle-method-none-radio" />
                    Don't charge anything
                  </label>
                </RadioGroup>
              </>
            )}
            <p className="text-sm font-medium text-ink border-t border-line pt-3" data-testid="settle-confirm-sentence">
              {confirmSentence()}
            </p>
            {problem && (
              <p className="text-sm text-bad" role="alert" data-testid="settle-problem">{problem}</p>
            )}
          </div>
        ) : null}

        <DialogFooter>
          {fallbackResult ? (
            <Button type="button" onClick={acknowledgeFallback} data-testid="settle-fallback-ok-button">
              OK
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange?.(false)} disabled={busy}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={confirm}
                disabled={busy || loading || !!previewError}
                data-testid="settle-confirm-button"
              >
                {busy ? "Working…" : "Confirm"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
