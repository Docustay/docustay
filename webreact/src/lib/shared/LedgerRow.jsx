// LedgerRow — one money line (who · label · date · amount). Ported from webui/src/lib/shared/LedgerRow.svelte.
// `leading` / `trailing` (optional nodes): shown before / after the row button, outside it (a checkbox or a menu cannot sit inside a <button>). Absent = the row is exactly as before.
export default function LedgerRow({ amount = 0, who = "", label = "", date = null, onClick = null, leading = null, trailing = null }) {
  const amountText = (amount / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  let dateText = "";
  if (date) { const d = new Date(date); if (!Number.isNaN(d.getTime())) dateText = d.toLocaleDateString("en-US", { day: "numeric", month: "short" }); }
  const wrapped = leading != null || trailing != null;
  const row = (
    <button type="button" className={`grid h-(--size-row) w-full grid-cols-[1.4fr_1.6fr_auto_auto] items-center gap-4 px-4 text-left text-ui hover:bg-paper ${wrapped ? "min-w-0 flex-1" : "border-b border-hair last:border-b-0"}`}
            onClick={() => onClick?.()} data-testid="ledger-row">
      <span className="truncate font-medium text-ink">{who}</span>
      <span className="truncate text-ink-2">{label}</span>
      <span className="text-meta text-mute">{dateText}</span>
      <span className="text-right tabular-nums text-ink">{amountText}</span>
    </button>
  );
  if (!wrapped) return row;
  return (
    <div className="flex items-center gap-2 border-b border-hair px-4 last:border-b-0" data-testid="ledger-row-wrap">
      {leading}
      {row}
      {trailing}
    </div>
  );
}
