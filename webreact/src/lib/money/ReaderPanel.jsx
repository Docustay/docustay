// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ReaderPanel — P3.U12 (W5). Built FROM specs/mockups/ReaderActions.frame.html (the card: reader name,
// online chip, the amount, the client/service line, and the persistent Charge/Show amount/Cancel/
// Refund-on-reader row) and specs/mockups/ReaderActionsStates.frame.html (every state below). No Svelte
// source — behaviour comes from the WIRING-MAP §3.3/§3.4 rows for these testids (each frame's own "What
// every control on this frame does" block) and CONTRACTS.md §4's exact request bodies.
//
// ★★★ `requestKey` (F803 lesson) — a NEW one is minted on every press of Charge/Show amount/Cancel/
//     Refund, never reused. `idempotency-key` (the HTTP header api.js already mints) and `requestKey`
//     (this body field, Stripe's own reader-action idempotency) are two different locks; reusing the
//     latter is exactly what let a retried Charge collide with a different press.
// ★ `device` is null when nothing has been ordered yet (Settings › Money › Hardware) — the whole panel
//   becomes the "No reader yet" band; there is no reader id to poll or write against.
// ★ deviceStatus is a GET: called directly (useWrite refuses GET routes), on mount and every 10s while
//   this panel stays mounted, cleared on unmount.
// ★ The overflow menu next to the reader's name holds the two controls that are not part of the
//   persistent toolbar the main frame draws: Rename, and the off-reader refund (by charge id, no card
//   needed) — the toolbar's own "Refund on reader" button is the present-card variant, since this panel
//   is the surface used while the client's card is still at the reader (WIRING-MAP's two refund rows).
// ★ A missing permission renders nothing (WriteButton's `hidden`); a missing prerequisite (reader
//   offline, or Stripe unreachable) renders DISABLED WITH THE REASON, never hidden (CLAUDE.md's rule).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from "react";
import { Ellipsis } from "lucide-react";
import { Button } from "@/lib/components/ui/button.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/lib/components/ui/dropdown-menu.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import Figure from "@/lib/components/kit/Figure.jsx";
import SheetRow from "@/lib/components/kit/SheetRow.jsx";
import ActionSurface from "@/lib/forms/ActionSurface.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import WriteButton from "@/lib/permissions/WriteButton.jsx";
import { useWrite } from "@/lib/permissions/useWrite.js";
import { api } from "@/lib/api.js";
import { ICON_STROKE } from "@/lib/empty/icons.js";

const OFFLINE_REASON = "The reader isn't online. Check it's on and on the same Wi-Fi.";
const UNKNOWN_REASON = "Reader status unknown — Stripe didn't answer";
const STATUS_POLL_MS = 10_000;

function newRequestKey() { return crypto.randomUUID(); }

/** One overflow-menu row: hidden → nothing; blocked → disabled with its reason; else the active item. */
function ActionItem({ testId, label, write, onSelect }) {
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
  return <DropdownMenuItem data-testid={testId} onSelect={onSelect}>{label}</DropdownMenuItem>;
}

/**
 * @param device { id, name, model? } | null — the physical reader; null → "No reader yet".
 * @param amountMinor integer minor units — the amount this panel is set to collect/refund.
 * @param payment { paymentIntentId, chargeId, amountLabel, personName, personEmail, serviceLabel } —
 *   the host screen's own transaction context; never invented here.
 */
export default function ReaderPanel({ device, amountMinor, payment }) {
  const [status, setStatus] = useState(device ? "loading" : null);
  const [paid, setPaid] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState(device?.name ?? "");
  const pollRef = useRef(null);

  const chargeBlocked = status === "offline" ? OFFLINE_REASON : status === "unknown" ? UNKNOWN_REASON : null;

  const charge = useWrite("readerCharge", { blockedReason: chargeBlocked });
  const display = useWrite("readerDisplay");
  const cancel = useWrite("readerCancel");
  const refundPresent = useWrite("readerRefund");
  const refund = useWrite("readerRefund");
  const rename = useWrite("renameDevice");

  useEffect(() => {
    if (!device) return undefined;
    let cancelled = false;
    async function poll() {
      try {
        const res = await api.deviceStatus(device.id);
        if (!cancelled) setStatus(res.status);
      } catch {
        if (!cancelled) setStatus("unknown");
      }
    }
    poll();
    pollRef.current = setInterval(poll, STATUS_POLL_MS);
    return () => { cancelled = true; clearInterval(pollRef.current); };
  }, [device?.id]);

  useEffect(() => { setPaid(false); }, [payment?.paymentIntentId]);
  useEffect(() => { setName(device?.name ?? ""); }, [device?.name]);

  if (!device) {
    return (
      <div className="rounded-card border border-line bg-surface p-5" data-testid="reader-panel" data-state="not-set-up">
        <p className="m-0 text-heading font-medium text-ink">No reader yet</p>
        <p className="mt-1.5 mb-0 text-ui text-mute">
          Order one in Settings › Money › Hardware, or use Tap to Pay on your phone.
        </p>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div className="rounded-card border border-line bg-surface p-5" data-testid="reader-panel" data-state="loading" aria-busy="true">
        <div className="h-5 w-40 animate-pulse rounded-sm bg-mute-bg" />
        <div className="mt-4 h-9 w-32 animate-pulse rounded-sm bg-mute-bg" />
      </div>
    );
  }

  const processing = charge.busy;
  const inlineError = charge.error || display.error || cancel.error || refundPresent.error || refund.error || rename.error;
  const chipTone = status === "online" ? "ok" : status === "offline" ? "bad" : "warn";
  const chipLabel = status === "online" ? "Online" : status === "offline" ? "Offline" : "Status unknown";
  const showRefundItem = !!payment?.chargeId;
  const hasMenu = !rename.hidden || (showRefundItem && !refund.hidden);

  async function handleCharge() {
    try {
      await charge.run({ readerId: device.id, paymentIntentId: payment?.paymentIntentId, amountMinor, requestKey: newRequestKey() });
      setPaid(true);
    } catch {
      // charge.error renders inline below — the panel stays open.
    }
  }
  async function handleDisplay() {
    try {
      await display.run({ readerId: device.id, displayType: "cart", displayText: payment?.amountLabel ?? null, requestKey: newRequestKey() });
    } catch {
      // display.error renders inline below.
    }
  }
  async function handleCancel() {
    try {
      await cancel.run({ readerId: device.id, requestKey: newRequestKey() });
      setPaid(false);
    } catch {
      // cancel.error renders inline below.
    }
  }
  async function handleRefundPresent() {
    try {
      await refundPresent.run({ chargeId: payment?.chargeId, amountMinor, reason: null, requestKey: newRequestKey() });
    } catch {
      // refundPresent.error renders inline below.
    }
  }
  async function handleRefund() {
    try {
      await refund.run({ chargeId: payment?.chargeId, amountMinor, reason: null, requestKey: newRequestKey() });
    } catch {
      // refund.error renders inline below.
    }
  }
  async function handleRename(e) {
    e?.preventDefault?.();
    try {
      await rename.run({ deviceId: device.id, name });
      setRenameOpen(false);
    } catch {
      // rename.error renders inline in the sheet below — it stays open.
    }
  }

  return (
    <div className="rounded-card border border-line bg-surface p-5" data-testid="reader-panel"
         data-state={paid ? "paid" : processing ? "processing" : "idle"}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <b className="font-medium text-ink" data-testid="reader-panel-name">{device.name}</b>
          <StatusBadge testId="reader-status" tone={chipTone} label={chipLabel} />
          {hasMenu && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" data-testid="reader-panel-menu" aria-label="Reader settings">
                  <Ellipsis strokeWidth={ICON_STROKE} aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <ActionItem testId="reader-rename" label="Rename reader" write={rename} onSelect={() => setRenameOpen(true)} />
                {showRefundItem && (
                  <ActionItem testId="reader-action-refund" label="Refund without the reader" write={refund} onSelect={handleRefund} />
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </span>
        <span className="text-meta text-mute">{device.model}</span>
      </div>

      <Figure testId="reader-panel-amount" size="lg" as="div" className="mt-4 mb-1.5">{payment?.amountLabel}</Figure>
      <p className="m-0 text-ui text-mute">{payment?.personName} · {payment?.serviceLabel}</p>

      {paid && (
        <div className="mt-4 flex flex-col gap-1.5">
          <StatusBadge testId="reader-panel-paid" tone="ok" label={`Paid — ${payment?.amountLabel}`} />
          <p className="m-0 text-ui text-mute">Receipt sent to {payment?.personEmail}.</p>
        </div>
      )}

      {processing && (
        <div className="mt-4 flex flex-col gap-1.5">
          <StatusBadge testId="reader-panel-waiting" tone="act" label="Tap, insert or swipe…" />
          <p className="m-0 text-ui text-mute">Cancel stays live; everything else waits.</p>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <WriteButton write={charge} testId="reader-action-charge" busyLabel="Charging…" onClick={handleCharge}>
          Charge on reader
        </WriteButton>
        <WriteButton write={display} testId="reader-action-display" variant="outline" disabled={processing} onClick={handleDisplay}>
          Show amount
        </WriteButton>
        <WriteButton write={cancel} testId="reader-action-cancel" variant="outline" onClick={handleCancel}>
          Cancel
        </WriteButton>
        <span className="flex-1" />
        <WriteButton write={refundPresent} testId="reader-action-refund-present" variant="outline" disabled={processing} onClick={handleRefundPresent}>
          Refund on reader
        </WriteButton>
      </div>

      {inlineError && <ErrorPanel error={inlineError} subject="This action" testId="reader-panel-error" />}

      {renameOpen && (
        <ActionSurface kind="dialog" testId="reader-rename-sheet" title="Rename reader" busy={rename.busy}
                        submitLabel="Save" onCancel={() => setRenameOpen(false)} onSubmit={handleRename}
                        error={rename.error ? rename.error.message : null}>
          <SheetRow label="Name" htmlFor="reader-rename-name">
            <Input id="reader-rename-name" data-testid="reader-rename-name" value={name} onChange={(e) => setName(e.target.value)} />
          </SheetRow>
        </ActionSurface>
      )}
    </div>
  );
}
