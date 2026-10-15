// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PlatTiersTable1Table — the capability grid table for PlatTiers.
// Ported from webui/src/lib/screens/platform/PlatTiers.svelte:178-215 (the `<table>` element).
// Props: error, tiers, grid, cellError, CAPABILITIES, capabilityLabel, handleTick.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export default function PlatTiersTable1Table({
  error,
  tiers,
  grid,
  cellError,
  CAPABILITIES,
  capabilityLabel,
  handleTick,
}) {
  return (
    <div className="border border-line rounded-[12px] bg-white overflow-auto">
      <table className="w-full border-collapse font-inter text-[13px] font-normal">
        <thead>
          <tr>
            <th className="text-left p-[10px_16px] font-inter text-[12px] font-semibold text-mute bg-surface-2 border-b border-line">
              Capability
            </th>
            {tiers.map((tier) => (
              <th
                key={tier.id}
                className="font-inter text-[12px] font-semibold text-mute bg-surface-2 border-b border-line border-l border-hair p-[10px_12px] text-center"
              >
                <div className="font-inter text-[12px] font-semibold text-ink2">
                  {tier.name}
                </div>
                <div className="font-inter text-[11px] font-normal text-mute mt-[2px]">
                  ${(tier.placeholder_price_minor / 100).toFixed(0)}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CAPABILITIES.map((capKey) => (
            <tr key={capKey} className="border-t border-hair">
              <td className="p-[8px_16px] text-ink2 font-normal">
                {capabilityLabel(capKey)}
              </td>
              {tiers.map((tier) => (
                <td
                  key={`${tier.id}-${capKey}`}
                  className="p-[8px_16px] text-center border-l border-hair relative"
                >
                  <button
                    className={`inline-flex items-center justify-center w-[17px] h-[17px] rounded-[5px] border-[1.5px] cursor-pointer transition-all ${
                      grid[tier.id]?.[capKey]
                        ? "bg-[var(--color-brand)] border-[var(--color-brand)] text-white font-inter text-[12px] font-semibold leading-[17px]"
                        : "bg-white border-line hover:border-[var(--color-brand)]"
                    } ${
                      cellError?.tierId === tier.id && cellError?.capKey === capKey
                        ? "border-error-edge"
                        : ""
                    }`}
                    onClick={() => handleTick(tier.id, capKey)}
                    title={
                      grid[tier.id]?.[capKey]
                        ? "✓ Enabled"
                        : "Enable capability"
                    }
                  >
                    {grid[tier.id]?.[capKey] && <span className="block">✓</span>}
                  </button>
                  {cellError?.tierId === tier.id && cellError?.capKey === capKey && (
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2 whitespace-nowrap bg-bad-bg border-bad-border rounded-[4px] p-[4px_8px] mt-[4px] text-[11px] text-bad z-10">
                      {cellError.message}
                    </div>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
