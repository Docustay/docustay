// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PayoutRow — One payout in the payouts list, displaying amount, arrival date, payment count,
// state badge, and a "See inside" button. Ported from webui/src/lib/money/PayoutRow.svelte.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { Button } from "@/lib/components/ui/button.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import { formatMoney } from "@/lib/screens/money/formatMoney.js";
import { BulkHeadCell, BulkRowCell, RowMenuHeadCell, RowMenuCell } from "@/lib/lists/BulkCells.jsx";

const TD = "h-(--size-row) border-b border-hair px-4 text-ui text-ink";

// Map payout state to status badge tone
function getStateTone(state) {
  switch (state) {
    case "paid":
      return "ok";
    case "in_transit":
    case "pending":
      return "act";
    case "failed":
      return "bad";
    default:
      return "neutral";
  }
}

// Get human-readable label for state
function getStateLabel(state) {
  switch (state) {
    case "paid":
      return "Landed";
    case "in_transit":
    case "pending":
      return "On its way";
    case "failed":
      return "Failed";
    default:
      return state;
  }
}

// Format date as "Mon, Jan 1" style
function formatPayoutDate(dateString) {
  if (!dateString) return "—";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "—";
  // ★ An arrival date is a CALENDAR date (Stripe: midnight UTC) — formatted in the viewer's zone it
  //   landed a day early (Sep 30 showed as "Tue, Sep 29" in the 2 Oct 2026 browser check).
  const options = { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" };
  return date.toLocaleDateString("en-US", options);
}

// `bulk` (optional, from useListBulk) adds the select cell first and the row menu last; absent = the row is exactly as before.
export default function PayoutRow({ payout, onSeeInside = null, bulk = null }) {

  return (
    <tr data-testid="payout-row">
      <BulkRowCell bulk={bulk} id={payout?.id} />
      <td className={`${TD} text-right`}>
        {formatMoney(payout?.amountMinor ?? 0)}
      </td>
      <td className={`${TD} text-right tabular-nums`}>
        {formatPayoutDate(payout?.arrivalDate)}
      </td>
      <td className={TD}>{payout?.payments ?? 0}</td>
      <td className={TD}>
        <StatusBadge
          label={getStateLabel(payout?.state)}
          tone={getStateTone(payout?.state)}
          testId="payout-state-badge"
        />
      </td>
      <td className={TD}>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onSeeInside?.(payout?.id)}
          data-testid="payout-see-inside"
        >
          See inside
        </Button>
      </td>
      {bulk?.selectable ? <RowMenuCell bulk={bulk} row={payout} /> : <td className={`${TD} text-right text-mute`}>⋯</td>}
    </tr>
  );
}
