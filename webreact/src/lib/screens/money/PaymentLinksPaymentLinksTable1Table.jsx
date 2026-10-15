// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R6.053.T1 — PaymentLinks › PaymentLinksPaymentLinksTable1Table: the empty state table
// Ported from webui/src/lib/screens/money/PaymentLinks.svelte:211-220
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";

export default function PaymentLinksPaymentLinksTable1Table({
  onNavigate = null,
  phase = "empty",
  links = [],
  openCreate = null,
}) {
  return (
    <LedgerPage
      title="Payment links"
      summary="A link that takes money. Put it anywhere — a text, a bio, a poster."
      primary={{ label: "New link", onClick: openCreate }}
      onNavigate={onNavigate}
    >
      <ScreenState phase="empty" />
    </LedgerPage>
  );
}
