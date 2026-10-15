// ═══════════════════════════════════════════════════════════════════════════════════════════════
// AdjustCreditSheet — P3.U9 (W3). Built FROM specs/mockups/PersonAdjustCredit.frame.html's right-hand
// sheet (structure, order, labels, every text run): give a person credit or take some away, with a
// required reason, and a computed "After" figure. The write is `adjustCredit` (CONTRACTS §4 /
// src/money/customerCredit.mjs's own handler): Stripe first — a refusal rolls the whole thing back and
// this surface stays open, showing Stripe's own reason and reference (write.error) — never a re-worded
// one (api.js's own rule).
// ★ Only the ACTUAL WRITE (the "Adjust balance" button) is gated on permission — the same convention
//   CreditNoteSheet uses: the fields above it are local state until pressed, so a denied viewer still
//   sees every figure (positive control), with only the write control itself absent.
// ★ A missing prerequisite (Stripe not connected) is `write.blocked`: WriteButton renders DISABLED WITH
//   THE REASON, never hidden — a blocked write is not a denied one. Bad LOCAL input (no amount typed, no
//   reason typed, a reason over 500 characters) disables the same button without inventing a second
//   reason string, exactly as PauseDialog/MarkPaidDialog leave their own local validation to a plain
//   disabled state.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import SideSheet from "@/lib/forms/SideSheet.jsx";
import SheetRow from "@/lib/components/kit/SheetRow.jsx";
import Figure from "@/lib/components/kit/Figure.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from "@/lib/components/ui/dropdown-menu.jsx";
import WriteButton from "@/lib/permissions/WriteButton.jsx";
import { useWrite } from "@/lib/permissions/useWrite.js";
import { formatMoney } from "@/lib/screens/money/formatMoney.js";
import { savedToast } from "@/lib/hooks/savedToast.js";

const KINDS = [
  { value: "add", label: "Add credit" },
  { value: "take_away", label: "Take away credit" },
];
const WHY_MAX = 500;

/**
 * @param person { id, creditBalanceMinor, currency?, blockedReason? } — the host screen's person
 *   record; `blockedReason` (e.g. "Connect Stripe first — Settings › Money.", customerCredit.mjs's own
 *   refusal) is the missing prerequisite, if any — a permission (`invoice.edit`) is decided by
 *   `useWrite` itself, never by this prop.
 * @param open, onOpenChange — the surface is only ever shown while `open`; `onOpenChange(false)` on
 *   cancel/close/Escape/after a successful write.
 * @param onAdjusted — called (with the write's result) after the balance is adjusted, so the host
 *   screen can refetch.
 */
export default function AdjustCreditSheet({ person, open, onOpenChange, onAdjusted }) {
  const write = useWrite("adjustCredit", { blockedReason: person?.blockedReason ?? null });
  const currency = person?.currency ?? "usd";
  const currentBalanceMinor = person?.creditBalanceMinor ?? 0;

  const [kind, setKind] = useState("add");
  const [amountInput, setAmountInput] = useState("");
  const [why, setWhy] = useState("");

  // Reset to this sheet's own defaults every time it opens, or for a different person.
  useEffect(() => {
    if (!open) return;
    setKind("add");
    setAmountInput("");
    setWhy("");
  }, [open, person?.id]);

  if (!open) return null;

  const parsedAmountMinor = (() => {
    const n = Number(amountInput);
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  })();
  const amountInvalid = parsedAmountMinor === null || parsedAmountMinor <= 0;
  const whyTrimmed = why.trim();
  const whyInvalid = whyTrimmed.length === 0 || whyTrimmed.length > WHY_MAX;
  const selectedKind = KINDS.find((k) => k.value === kind) ?? KINDS[0];

  const signedAmountMinor = parsedAmountMinor === null
    ? 0
    : (kind === "take_away" ? -parsedAmountMinor : parsedAmountMinor);
  const newBalanceMinor = currentBalanceMinor + signedAmountMinor;

  // ★ save-system brief, 30 Sep 2026 — dirty iff something was actually typed; drives the
  //   unsaved-changes warning below (SideSheet's own `dirty` prop).
  const dirty = amountInput.trim() !== "" || why.trim() !== "";

  async function handleAdjust() {
    if (amountInvalid || whyInvalid || write.blocked) return;
    const result = await write.run({
      subjectType: "person",
      subjectId: person.id,
      amountMinor: signedAmountMinor,
      note: whyTrimmed,
    });
    savedToast("Credit adjusted");
    onAdjusted?.(result);
    onOpenChange?.(false);
  }

  return (
    <SideSheet
      title="Adjust credit balance"
      testId="adjust-credit-sheet"
      busy={write.busy}
      dirty={dirty}
      onCancel={() => onOpenChange?.(false)}
      error={write.error
        ? `${write.error.message}${write.error.requestId ? ` (ref: ${write.error.requestId})` : ""}`
        : null}
      footer={(
        <footer className="sticky bottom-0 flex shrink-0 justify-end gap-2.5 border-t border-line bg-surface px-5.5 py-4">
          <Button type="button" variant="outline" data-testid="adjust-credit-cancel" onClick={() => onOpenChange?.(false)}>
            Cancel
          </Button>
          <WriteButton write={write} testId="adjust-credit-submit" type="button" busyLabel="Adjusting…"
                       disabled={amountInvalid || whyInvalid} onClick={handleAdjust}>
            Adjust balance
          </WriteButton>
        </footer>
      )}
    >
      <div className="mb-2 mt-1 text-micro font-semibold tracking-[0.08em] text-mute uppercase">Change</div>

      <SheetRow label="Add or take away">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" data-testid="adjust-credit-kind"
                    className="flex h-(--size-control-field) w-full items-center justify-between rounded-control border border-line bg-surface px-3 text-field text-ink">
              <span>{selectedKind.label}</span>
              <span aria-hidden="true" className="text-mute">⌄</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent data-testid="adjust-credit-kind-menu">
            <DropdownMenuRadioGroup value={kind} onValueChange={setKind}>
              {KINDS.map((k) => (
                <DropdownMenuRadioItem key={k.value} value={k.value} data-testid={`adjust-credit-kind-${k.value}`}>
                  {k.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SheetRow>

      <SheetRow label="Amount">
        <Input name="amount" data-testid="adjust-credit-amount" inputMode="decimal" placeholder="$0.00"
               value={amountInput} onChange={(e) => setAmountInput(e.target.value)} />
      </SheetRow>

      <SheetRow label="Why"
                hint={whyTrimmed.length > WHY_MAX ? `500 characters or fewer (${whyTrimmed.length}).` : null}>
        <Input name="why" data-testid="adjust-credit-why"
               placeholder="Goodwill for the rescheduled session — they’ll see this"
               value={why} onChange={(e) => setWhy(e.target.value)} />
      </SheetRow>

      <div className="mb-2 mt-4 text-micro font-semibold tracking-[0.08em] text-mute uppercase">After</div>

      <SheetRow label="New balance">
        <Figure size="md" testId="adjust-credit-new-balance">
          {formatMoney(newBalanceMinor, currency)} — used first on their next invoice
        </Figure>
      </SheetRow>
    </SideSheet>
  );
}
