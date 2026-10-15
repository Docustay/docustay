// ═══════════════════════════════════════════════════════════════════════════════════════════════
// EditAccountSheet — P3.U28 (S6). Built FROM specs/mockups/EditAccountNetwork.frame.html's right-hand
// sheet ("Edit Harbor Clinic" — the "Account" section: Name / Billing email / Owner, sticky Cancel/Save
// footer). Calls (api.js, P3.A): `updateAccount` or `updateNetworkParty`.
//
// ★★★ ONE SHEET, TWO WRITES — `account.kind` ('account' | 'network_party') picks which. The frame draws
//     only the account variant; there is no separate network-party frame in this stage, so the network
//     variant reuses the same structure (section title, label-left/field-right rows, sticky footer) with
//     its own fields: Name and Kind (both accepted by `updateNetworkParty`, CONTRACTS §4). This is a
//     documented, not guessed, choice — the alternative (stopping the task for a missing frame) was
//     rejected because the task text itself assigns the sheet both writes and says "say so here".
//     `account.partyKind` is the network party's OWN kind value (referral partner / vendor / etc.) — kept
//     separate from the discriminator prop `account.kind` so the two never collide.
//
// ★ Only `updateAccount`'s and `updateNetworkParty`'s OWN accepted fields are editable (api.js:1660,1816):
//   account → `name` only; network_party → `name` and `kind`. The frame also draws "Billing email" and
//   "Owner" for the account variant — neither is in `updateAccount`'s body, so both render via
//   DisabledWithReason (a field with no write behind it yet is disabled-with-a-reason, never a control
//   that looks live and silently does nothing — WriteButton.jsx's own rule, applied to plain fields too).
//   Their values render through Figure so they stay a stable positive control regardless of permission,
//   the same convention AdjustCreditSheet.jsx uses for its own "After" figure.
// ★ Only the ACTUAL WRITE (the Save button) is gated on permission (`useWrite`/`WriteButton`, K6a) — the
//   Name/Kind inputs above it are local state until pressed, exactly as AdjustCreditSheet's fields are.
// ★ Two testids for the one Save control, one per kind: `account-edit` / `network-edit` (WIRING-MAP's own
//   names for these two writes).
// ★ STATES not built here, and why: the frame draws no first-run/empty band (this is a fixed-field edit
//   sheet, not a list) and ships no dedicated phone mockup — `PhoneWidth375` below tests SideSheet's own
//   built-in responsive behaviour instead, the same as AdjustCreditSheet.stories.jsx does.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import SideSheet from "@/lib/forms/SideSheet.jsx";
import SheetRow, { SheetSection } from "@/lib/components/kit/SheetRow.jsx";
import Figure from "@/lib/components/kit/Figure.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import WriteButton from "@/lib/permissions/WriteButton.jsx";
import { useWrite } from "@/lib/permissions/useWrite.js";

/**
 * @param account { kind: 'account'|'network_party', id, name, billingEmail?, ownerName?, partyKind?,
 *   blockedReason? } — `blockedReason` is a missing prerequisite (e.g. "This account is synced from the
 *   parent organisation and can't be renamed here."), decided by the caller, never by this component
 *   (AdjustCreditSheet.jsx's own convention).
 * @param open, onOpenChange — shown only while `open`; `onOpenChange(false)` on cancel/close/Escape/after
 *   a successful write.
 */
export default function EditAccountSheet({ account, open, onOpenChange }) {
  const isAccount = account?.kind === "account";
  const writeName = isAccount ? "updateAccount" : "updateNetworkParty";
  const write = useWrite(writeName, { blockedReason: account?.blockedReason ?? null });

  const [name, setName] = useState("");
  const [partyKind, setPartyKind] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(account?.name ?? "");
    setPartyKind(account?.partyKind ?? "");
  }, [open, account?.id]);

  if (!open) return null;

  const trimmedName = name.trim();
  const trimmedKind = partyKind.trim();
  const nameInvalid = trimmedName.length === 0;
  const kindInvalid = !isAccount && trimmedKind.length === 0;
  const nameChanged = trimmedName !== (account?.name ?? "");
  const kindChanged = !isAccount && trimmedKind !== (account?.partyKind ?? "");
  const nothingChanged = isAccount ? !nameChanged : !nameChanged && !kindChanged;

  async function handleSave() {
    if (nameInvalid || kindInvalid || nothingChanged || write.blocked) return;
    if (isAccount) {
      await write.run({ accountId: account.id, ...(nameChanged ? { name: trimmedName } : {}) });
    } else {
      await write.run({
        partyId: account.id,
        ...(nameChanged ? { name: trimmedName } : {}),
        ...(kindChanged ? { kind: trimmedKind } : {}),
      });
    }
    onOpenChange?.(false);
  }

  const sheetTestId = isAccount ? "edit-account-sheet" : "edit-network-sheet";
  const saveTestId = isAccount ? "account-edit" : "network-edit";

  return (
    <SideSheet
      title={`Edit ${account?.name ?? ""}`}
      testId={sheetTestId}
      busy={write.busy}
      onCancel={() => onOpenChange?.(false)}
      error={write.error
        ? `${write.error.message}${write.error.requestId ? ` (ref: ${write.error.requestId})` : ""}`
        : null}
      footer={(
        <footer className="sticky bottom-0 flex shrink-0 justify-end gap-2.5 border-t border-line bg-surface px-5.5 py-4">
          <Button type="button" variant="outline" data-testid={isAccount ? "edit-account-cancel" : "edit-network-cancel"}
                  onClick={() => onOpenChange?.(false)}>
            Cancel
          </Button>
          <WriteButton write={write} testId={saveTestId} type="button" busyLabel="Saving…"
                       disabled={nameInvalid || kindInvalid || nothingChanged} onClick={handleSave}>
            Save
          </WriteButton>
        </footer>
      )}
    >
      <SheetSection title={isAccount ? "Account" : "Network"}>
        <SheetRow label="Name">
          <Input name="name" data-testid={isAccount ? "edit-account-name" : "edit-network-name"}
                 value={name} onChange={(e) => setName(e.target.value)} />
        </SheetRow>

        {isAccount ? (
          <>
            <SheetRow label="Billing email">
              <DisabledWithReason disabled reason="Not editable here yet." testId="edit-account-billing-email">
                {() => <Figure size="sm" testId="edit-account-billing-email-value">{account?.billingEmail || "—"}</Figure>}
              </DisabledWithReason>
            </SheetRow>
            <SheetRow label="Owner">
              <DisabledWithReason disabled reason="Not editable here yet." testId="edit-account-owner">
                {() => <Figure size="sm" testId="edit-account-owner-value">{account?.ownerName || "—"}</Figure>}
              </DisabledWithReason>
            </SheetRow>
          </>
        ) : (
          <SheetRow label="Kind">
            <Input name="kind" data-testid="edit-network-kind"
                   value={partyKind} onChange={(e) => setPartyKind(e.target.value)} />
          </SheetRow>
        )}
      </SheetSection>
    </SideSheet>
  );
}
