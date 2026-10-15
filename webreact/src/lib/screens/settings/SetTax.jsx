// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.027 — SetTax: tax settings screen
// Ported from webui/src/lib/screens/settings/SetTax.svelte
// Stripe's embedded tax surfaces (registrations and settings).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import SetTaxTaxTable from "./SetTaxTaxTable.jsx";

export default function SetTax({ onNavigate = null }) {
  return (
    <div data-testid="settings-tax">
      <SetTaxTaxTable onNavigate={onNavigate} />
    </div>
  );
}
