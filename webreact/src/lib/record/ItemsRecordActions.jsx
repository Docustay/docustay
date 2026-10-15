import { useState, useMemo } from "react";
import { api, ApiError } from "@/lib/api.js";
import { RANK_ORDER } from "@/lib/permissions/rank.js";
import { Button } from "@/lib/components/ui/button.jsx";
import ItemsRecordActionsItemStopSellingConfirm from "./ItemsRecordActionsItemStopSellingConfirm.jsx";

export default function ItemsRecordActions({ item = null, whatKeepsWorking = {}, rank = null, onDone = null }) {
  // ★ Stop selling / Sell again is `object:"item", action:"edit"` — owner/admin (02-items.md §4),
  //   the same tier as every other catalogue-definition write.
  const isAdmin = RANK_ORDER.indexOf(rank ?? "") >= RANK_ORDER.indexOf("admin");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [sellAgainBusy, setSellAgainBusy] = useState(false);
  const [sellAgainProblem, setSellAgainProblem] = useState(null);

  async function stopSelling() {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.setItemActive({ itemType: item.itemType, itemId: item.id, active: false });
      setConfirmOpen(false);
      onDone?.();
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  async function sellAgain() {
    if (sellAgainBusy) return;
    setSellAgainBusy(true);
    setSellAgainProblem(null);
    try {
      await api.setItemActive({ itemType: item.itemType, itemId: item.id, active: true });
      onDone?.();
    } catch (err) {
      setSellAgainProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setSellAgainBusy(false);
    }
  }

  const bullets = useMemo(() => {
    const out = [];
    const pk = whatKeepsWorking?.activePackages ?? 0;
    const pl = whatKeepsWorking?.livePlanSubscribers ?? 0;
    const fb = whatKeepsWorking?.futureBookings ?? 0;
    if (pk > 0) out.push(`${pk} package${pk === 1 ? "" : "s"} still include it`);
    if (pl > 0) out.push(`${pl} subscriber${pl === 1 ? "" : "s"} keep getting what they signed up for`);
    if (fb > 0) out.push(`${fb} future booking${fb === 1 ? "" : "s"} stay booked`);
    return out;
  }, [whatKeepsWorking]);

  if (!item || !isAdmin) return null;

  return (
    <>
      {item.active ? (
        <Button
          type="button"
          variant="default"
          size="sm"
          data-testid="item-stop-selling-trigger"
          onClick={() => {
            setProblem(null);
            setConfirmOpen(true);
          }}
        >
          Stop selling
        </Button>
      ) : (
        <>
          <Button
            type="button"
            variant="default"
            size="sm"
            data-testid="item-sell-again-trigger"
            disabled={sellAgainBusy}
            onClick={sellAgain}
          >
            {sellAgainBusy ? "Working…" : "Sell again"}
          </Button>
          {sellAgainProblem && (
            <span className="text-meta text-destructive" data-testid="item-sell-again-error" role="alert">
              {sellAgainProblem}
            </span>
          )}
        </>
      )}

      <ItemsRecordActionsItemStopSellingConfirm
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        item={item}
        busy={busy}
        problem={problem}
        stopSelling={stopSelling}
        bullets={bullets}
      />
    </>
  );
}
