// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.027.T1 — SetTaxTaxTable: the tax page content as its own component
// ★ the maintainer's ruling, 28 Sep 2026 — no embedded Stripe screens. Real tax settings + registrations, read
//   live from Stripe's Tax API (src/money/tax.mjs). Adding a NEW registration routes to Stripe's
//   own hosted wizard — a real, consequential tax object whose body shape differs by country/state,
//   the same "hosted redirect, not an embed" exception the maintainer carved out for new-account onboarding.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { request } from "@/lib/api.js";
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";

// ★ F139 — Stripe's raw enum values ("active", "inferred_by_currency") in plain words. Meanings are
//   Stripe Tax's own: settings.status active|pending; defaults.tax_behavior inclusive|exclusive|
//   inferred_by_currency (Stripe decides by the price's currency — tax added on top for USD and CAD,
//   included in the price for most other currencies); registration status active|scheduled|expired.
const TAX_STATUS_WORDS = Object.freeze({
  active: "Tax is on",
  pending: "Not on yet: Stripe needs more details",
});
const TAX_BEHAVIOR_WORDS = Object.freeze({
  inclusive: "Prices include tax",
  exclusive: "Tax is added on top of prices",
  inferred_by_currency: "Set by currency: added on top for US and Canadian dollars, included in the price for most others",
});
const REGISTRATION_STATUS_WORDS = Object.freeze({ active: "Collecting", scheduled: "Starts later", expired: "Ended" });
const plain = (map, v) => (v == null ? "—" : map[v] ?? String(v).replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()));

export default function SetTaxTaxTable({ onNavigate }) {
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);
  const [tax, setTax] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      setPhase("loading");
      const res = await request("/api/money/tax");
      setTax(res);
      setPhase("ready");
    } catch (err) {
      if (err?.status === 403) setPhase("denied");
      else { setError(err); setPhase("error"); }
    }
  }

  if (phase === "loading") return <ScreenState phase="loading" />;
  if (phase === "denied") return <ScreenState phase="denied" />;
  if (phase === "error") return <ScreenState phase="error" error={error} onRetry={load} />;

  return (
    <LedgerPage
      title="Tax"
      summary="Where you're registered to collect tax, and how Stripe calculates it. Tax codes for each item are set in the item's editor."
      onNavigate={onNavigate}
    >
      <div className="flex flex-col gap-5.5">
        <div className="rounded-card border border-line bg-surface p-4.25">
          <div className="mb-3 flex items-center justify-between">
            <b className="text-sm font-semibold">Tax registrations</b>
            <a
              href="https://dashboard.stripe.com/tax/registrations"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-brand underline"
              data-testid="tax-registrations-add-link"
            >
              Register in a new jurisdiction on Stripe →
            </a>
          </div>
          {tax?.registrations?.length > 0 ? (
            <div className="flex flex-col gap-2" data-testid="tax-registrations-list">
              {tax.registrations.map((r) => (
                <div key={r.id} className="flex items-center justify-between border-b border-hair py-2 last:border-b-0 text-ui">
                  <span>{r.country}</span>
                  <span className={`text-xs font-medium ${r.status === "active" ? "text-ok" : "text-mute"}`}>{plain(REGISTRATION_STATUS_WORDS, r.status)}</span>
                  <span className="text-xs text-mute">
                    {r.activeFrom ? new Date(r.activeFrom).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-ui text-mute">No tax registrations yet.</div>
          )}
        </div>

        <div className="rounded-card border border-line bg-surface p-4.25">
          <b className="mb-3 block text-sm font-semibold">Tax settings</b>
          <div className="flex flex-col gap-2 text-ui">
            <div className="flex items-center justify-between border-b border-hair py-2">
              <span className="text-mute">Status</span>
              <span className={tax?.settings?.status === "active" ? "text-ok" : "text-warn"}>{plain(TAX_STATUS_WORDS, tax?.settings?.status)}</span>
            </div>
            <div className="flex items-center justify-between border-b border-hair py-2">
              <span className="text-mute">Prices and tax</span>
              <span className="text-right">{plain(TAX_BEHAVIOR_WORDS, tax?.settings?.taxBehavior)}</span>
            </div>
            <div className="flex items-center justify-between border-b border-hair py-2 last:border-b-0">
              <span className="text-mute">Head office</span>
              <span>
                {tax?.settings?.headOfficeAddress
                  ? `${tax.settings.headOfficeAddress.city}, ${tax.settings.headOfficeAddress.state} ${tax.settings.headOfficeAddress.postal_code}`
                  : "—"}
              </span>
            </div>
          </div>
          <div className="mt-3">
            <a
              href="https://dashboard.stripe.com/settings/tax"
              target="_blank"
              rel="noreferrer"
              data-testid="tax-settings-manage-link"
              className="text-xs text-brand underline"
            >
              Manage on Stripe →
            </a>
          </div>
        </div>
      </div>
    </LedgerPage>
  );
}
