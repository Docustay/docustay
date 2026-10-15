// ═══════════════════════════════════════════════════════════════════════════════════════════════
// WalletDomainRow — P3.U20 (W13). Settings › Money's wallets row: whether Apple Pay / Google Pay show
// on the practice's pay pages. No Svelte source — behaviour comes from the WIRING-MAP §3.4 row for
// `wallet-domains` (W13) and this frame's own "What every control on this frame does" block, quoted
// below. Ported from specs/mockups/SetWalletDomains.frame.html's card ("Apple Pay and Google Pay on
// your pay pages" / domain / chip) — one such row per entry `walletDomains()` returns, same order,
// same text runs.
//
// ★ NO WRITES (PHASE-3.md field 4: "Opens: —"). This row only ever reads `api.walletDomains()` — a
//   GET, called directly (useWrite refuses GETs, api.js's own rule) — and shows what Stripe last told
//   us. There is nothing here for a permission to hide; the frame's states board's "no permission"
//   cell is satisfied trivially (no write control ever existed to begin with), the figures/chip stay.
// ★ "status chip per domain; unreachable → 'Status unknown'; card payments unaffected line"
//   (PHASE-3.md field 4, WIRING-MAP §3.4 · W13): `walletDomains()` resolves `{domains, unavailable?}`.
//   `unavailable` is Stripe-couldn't-confirm, NOT a thrown error — the domains are still shown (last
//   known list), every chip reads "Status unknown", and the standing reason line renders once beneath
//   them. This is exactly DisabledWithReason's shape (a missing PREREQUISITE — confirmation from
//   Stripe — renders disabled with the reason beside it, never hidden), reused here for a read-only
//   figure instead of a control, so one component gives both the disabled-with-reason state AND the
//   ordinary case (its `reason` span only renders when `disabled` is true).
// ★ A THROWN error (network/5xx) is the separate "error" state — same idiom as every other read in
//   this codebase (PersonMoneyBlock's ledger/cards/tax-id reads): ErrorPanel, the server's own message
//   and reference, nothing else on the page disturbed.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import { api } from "@/lib/api.js";

const UNAVAILABLE_REASON = "Card payments are unaffected.";

const STATUS_TONE = { registered: "ok", pending: "warn", failed: "bad" };
const STATUS_LABEL = { registered: "Registered", pending: "Pending", failed: "Failed" };

export default function WalletDomainRow() {
  const [state, setState] = useState({ loading: true, error: null, domains: [], unavailable: false });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const result = await api.walletDomains();
      setState({ loading: false, error: null, domains: result?.domains ?? [], unavailable: !!result?.unavailable });
    } catch (error) {
      setState({ loading: false, error, domains: [], unavailable: false });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col gap-3" data-testid="wallet-domains">
      {state.loading ? (
        <div className="rounded-card border border-line bg-surface p-4.5" aria-busy="true" data-testid="wallet-domains-loading">
          <span className="block h-4 w-2/3 rounded-sm bg-mute-bg" />
        </div>
      ) : state.error ? (
        <ErrorPanel error={state.error} subject="Wallet domains" testId="wallet-domains-error" />
      ) : state.domains.length === 0 ? (
        <p className="m-0 text-ui text-mute" data-testid="wallet-domains-empty">No pay page domains registered yet.</p>
      ) : (
        <DisabledWithReason disabled={state.unavailable} reason={UNAVAILABLE_REASON} testId="wallet-domains-unavailable">
          {() => (
            <div className="flex w-full flex-col gap-3">
              {state.domains.map((d, index) => {
                const tone = state.unavailable ? "neutral" : (STATUS_TONE[d.status] ?? "neutral");
                const label = state.unavailable ? "Status unknown" : (STATUS_LABEL[d.status] ?? d.status);
                return (
                  <div key={`${d.domain}-${index}`} className="rounded-card border border-line bg-surface p-4.5"
                       data-testid={`wallet-domain-row-${index}`}>
                    <div className="flex items-center justify-between gap-3">
                      <span>
                        <b className="font-medium text-ink">Apple Pay and Google Pay on your pay pages</b>
                        <br />
                        <span className="text-ui text-mute" data-testid={`wallet-domain-name-${index}`}>{d.domain}</span>
                      </span>
                      <StatusBadge tone={tone} label={label} testId={`wallet-domain-status-${index}`} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DisabledWithReason>
      )}
    </div>
  );
}
