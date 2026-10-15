// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R6.036 — MoneyAccountManagement: rebuild from the frame on the archetype
// Ported from webui/src/lib/screens/money/MoneyAccountManagement.svelte
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import MoneyAccountManagementAccountManagementTable from "./MoneyAccountManagementAccountManagementTable.jsx";

export default function MoneyAccountManagement({ onNavigate = null }) {
  return (
    <div data-testid="money-account-management">
      <MoneyAccountManagementAccountManagementTable onNavigate={onNavigate} />
    </div>
  );
}
