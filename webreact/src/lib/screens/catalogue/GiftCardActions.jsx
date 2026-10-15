// ═══════════════════════════════════════════════════════════════════════════════════════════════
// GiftCardActions — P3.U24 (S4). Built FROM specs/mockups/GiftCardActions.frame.html's gift-card
// table row (Code · For · Left · Status · actions) and its "New gift card" primary button, ported
// verbatim: same labels, same chip tone (`.chip.ok` → "Active"), same three ghost row actions
// (Resend, Nudge, Void). ONE component covers both mounts the frame draws (WIRING-MAP §3.3/§3.4,
// CONTRACTS §8 S4 testids):
//   · the page header's "New gift card" button — `row` carries no `id`, only `enabled` (the
//     tenant's `giftcards.enabled` setting, read once by the host screen for the whole list).
//   · one existing card's row actions — `row` carries `id`, `code`, `holderName`, `remainingMinor`,
//     `currency`, `status` — Resend / Nudge / Void.
// Four writes, one permission check each (`item.gift_card.manage`, owner/admin only —
// `src/routes/itemsGiftCards.mjs`'s `GIFT_CARD_WRITES`), one error band each (WIRING-MAP §5, api.js's
// own rule: the server's message, never re-worded):
//   · New gift card → `issueGiftCard` — `src/items/giftCards.mjs` refuses with exactly "Gift cards
//     are off. Turn them on first." when the setting is off. That SAME sentence is also the
//     CLIENT-SIDE prerequisite (field 4): `row.enabled === false` blocks the button before any
//     request is sent, DISABLED WITH THE REASON (`useWrite`'s `blockedReason`) — never hidden, a
//     missing prerequisite is never a permission (the maintainer's rule; RefundRequestRow follows the same idiom
//     for a missing Stripe connection).
//   · Resend → `resendGiftCard` — mints a new code, no dialog (the frame draws a single ghost
//     button, not a confirmation).
//   · Nudge  → `nudgeGiftCard` — one notification, no dialog.
//   · Void   → `voidGiftCard` — destructive DecisionModal: irreversible (a voided card can never be
//     un-voided or spent again), the consequence sentence DecisionModal's own refusal requires.
// `useWrite`'s `hidden` decides all four identically for a viewer without `item.gift_card.manage`:
// every WriteButton below renders NOTHING and the row's own figures (code, holder, remaining
// balance, status) still render — the positive control CLAUDE.md's rule requires.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import WriteButton from "@/lib/permissions/WriteButton.jsx";
import { useWrite } from "@/lib/permissions/useWrite.js";
import DecisionModal from "@/lib/forms/DecisionModal.jsx";
import ActionSurface from "@/lib/forms/ActionSurface.jsx";
import SheetRow from "@/lib/components/kit/SheetRow.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import Figure from "@/lib/components/kit/Figure.jsx";
import { formatMoney } from "@/lib/screens/money/formatMoney.js";

const TD = "h-(--size-row) border-b border-hair px-4 text-ui text-ink";

const STATUS = {
  active: { label: "Active", tone: "ok" },
  voided: { label: "Void", tone: "bad" },
  expired: { label: "Expired", tone: "neutral" },
  redeemed: { label: "Redeemed", tone: "neutral" },
};

function ErrorText({ error, testId }) {
  if (!error) return null;
  return (
    <>
      <span data-testid={`${testId}-message`}>{error.message}</span>
      {error.requestId && (
        <>
          <br />
          <span className="text-meta text-mute" data-testid={`${testId}-reference`}>Reference: {error.requestId}</span>
        </>
      )}
    </>
  );
}

/** Resend/Nudge have no dialog to hold their error (the frame draws a single ghost button, not a
 *  confirmation) — this is the same bad-bg banner DecisionModal/ActionSurface wrap their own
 *  `error` prop in, rendered inline so "each renders write.error" holds for these two as well. */
function WriteErrorBand({ error, testId }) {
  if (!error) return null;
  return (
    <p className="mt-2 rounded-sm border border-bad-border bg-bad-bg px-3 py-2.5 text-meta text-bad" role="alert" data-testid={testId}>
      <ErrorText error={error} testId={testId} />
    </p>
  );
}

/** dollars ("12.50") → integer cents, or null when not a valid positive amount. */
function toMinorUnits(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const minor = Math.round(Number(trimmed) * 100);
  return minor > 0 ? minor : null;
}

/**
 * @param row null | { enabled } — the "New gift card" mount (no `id`)
 *          | { id, enabled, code, holderName, remainingMinor, currency, status, blockedReason } —
 *            one existing card's row actions. `status` ∈ "active" (the frame's own default) ·
 *            "voided" · "expired" · "redeemed".
 * @param onChanged — called after any successful write, so the host screen refetches.
 */
export default function GiftCardActions({ row, onChanged }) {
  return row?.id ? <ExistingGiftCard row={row} onChanged={onChanged} /> : <NewGiftCard row={row} onChanged={onChanged} />;
}

function NewGiftCard({ row, onChanged }) {
  const enabled = row?.enabled !== false;
  const issue = useWrite("issueGiftCard", {
    blockedReason: enabled ? null : "Gift cards are off. Turn them on first.",
  });
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [holderEmail, setHolderEmail] = useState("");

  const amountMinor = toMinorUnits(amount);
  const emailTrimmed = holderEmail.trim();
  const emailInvalid = emailTrimmed.length > 0 && !emailTrimmed.includes("@");
  const submitDisabled = amountMinor === null || currency.trim().length !== 3 || emailInvalid;

  async function handleSubmit() {
    if (submitDisabled) return;
    try {
      await issue.run({
        amountMinor,
        currency: currency.trim().toUpperCase(),
        holderEmail: emailTrimmed.length > 0 ? emailTrimmed : null,
      });
      setOpen(false);
      setAmount(""); setCurrency("USD"); setHolderEmail("");
      onChanged?.();
    } catch {
      // issue.error is already set — the surface stays open and shows it (below).
    }
  }

  return (
    <>
      <WriteButton write={issue} testId="gift-card-new" onClick={() => setOpen(true)}>
        New gift card
      </WriteButton>
      {open && (
        <ActionSurface
          kind="dialog"
          testId="gift-card-new-surface"
          title="New gift card"
          busy={issue.busy}
          submitLabel="Issue gift card"
          submitDisabled={submitDisabled}
          onCancel={() => setOpen(false)}
          onSubmit={handleSubmit}
          error={issue.error ? <ErrorText error={issue.error} testId="gift-card-new-surface-error" /> : null}
        >
          <SheetRow label="Amount" required>
            <Input name="amount" data-testid="gift-card-new-amount" placeholder="0.00"
                   value={amount} onChange={(e) => setAmount(e.target.value)} />
          </SheetRow>
          <SheetRow label="Currency" required>
            <Input name="currency" data-testid="gift-card-new-currency"
                   value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
          </SheetRow>
          <SheetRow label="Holder email" optional
                    hint={emailInvalid ? "That doesn't look like an email address." : null}>
            <Input name="holderEmail" data-testid="gift-card-new-holder-email"
                   placeholder="who gets the code"
                   value={holderEmail} onChange={(e) => setHolderEmail(e.target.value)} />
          </SheetRow>
        </ActionSurface>
      )}
    </>
  );
}

function ExistingGiftCard({ row, onChanged }) {
  const resend = useWrite("resendGiftCard", { blockedReason: row?.blockedReason ?? null });
  const nudge = useWrite("nudgeGiftCard", { blockedReason: row?.blockedReason ?? null });
  const voidWrite = useWrite("voidGiftCard", { blockedReason: row?.blockedReason ?? null });
  const [voidOpen, setVoidOpen] = useState(false);

  const status = STATUS[row?.status ?? "active"] ?? STATUS.active;
  const currency = row?.currency ?? "USD";
  const remainingText = formatMoney(row?.remainingMinor ?? 0, currency);

  async function handleResend() {
    try { await resend.run({ id: row.id }); onChanged?.(); } catch { /* resend.error shown below */ }
  }
  async function handleNudge() {
    try { await nudge.run({ id: row.id }); onChanged?.(); } catch { /* nudge.error shown below */ }
  }
  async function handleVoid() {
    try {
      await voidWrite.run({ id: row.id });
      setVoidOpen(false);
      onChanged?.();
    } catch {
      // voidWrite.error is already set — the modal stays open and shows it (below).
    }
  }

  return (
    <tr data-testid="gift-card-row">
      <td className={TD}>{row?.code}</td>
      <td className={TD}>{row?.holderName ?? "—"}</td>
      <td className={`${TD} text-right`}>
        <Figure size="sm" testId="gift-card-remaining">{remainingText}</Figure>
      </td>
      <td className={TD}>
        <StatusBadge label={status.label} tone={status.tone} testId="gift-card-status" />
      </td>
      <td className={`${TD} text-right`}>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center justify-end gap-2">
            <WriteButton write={resend} testId="gift-card-resend" variant="outline" onClick={handleResend}>
              Resend
            </WriteButton>
            <WriteButton write={nudge} testId="gift-card-nudge" variant="outline" onClick={handleNudge}>
              Nudge
            </WriteButton>
            <WriteButton write={voidWrite} testId="gift-card-void" variant="outline" onClick={() => setVoidOpen(true)}>
              Void
            </WriteButton>
          </div>
          <WriteErrorBand error={resend.error} testId="gift-card-resend-error" />
          <WriteErrorBand error={nudge.error} testId="gift-card-nudge-error" />
        </div>
      </td>

      {voidOpen && (
        <DecisionModal
          open={voidOpen}
          onOpenChange={setVoidOpen}
          testId="gift-card-void-modal"
          title={`Void gift card ${row?.code}?`}
          danger
          cancelLabel="Keep it"
          confirmLabel="Void gift card"
          busy={voidWrite.busy}
          error={voidWrite.error ? <ErrorText error={voidWrite.error} testId="gift-card-void-modal-error" /> : null}
          onCancel={() => setVoidOpen(false)}
          onConfirm={handleVoid}
        >
          <p className="m-0 text-control leading-relaxed text-ink-2" data-testid="gift-card-void-modal-body">
            <b className="text-ink">{remainingText}</b>{" is lost — a voided gift card can never be spent or restored."}
          </p>
        </DecisionModal>
      )}
    </tr>
  );
}
