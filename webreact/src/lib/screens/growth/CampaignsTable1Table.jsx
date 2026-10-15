// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CampaignsTable1Table — the table from Campaigns screen at webui/src/lib/screens/growth/Campaigns.svelte:148-197.
// Props: campaigns, formatNumber. Ported from source range.
// Archetype: DataTable (kit) — but here built as a plain table via kit primitives.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import { BulkHeadCell, BulkRowCell, RowMenuHeadCell, RowMenuCell } from "@/lib/lists/BulkCells.jsx";

export default function CampaignsTable1Table({ campaigns, formatNumber, bulk = null }) {
  return (
    <div className="bg-surface border border-line rounded-[12px] overflow-hidden">
      <table className="w-full border-collapse" data-testid="campaigns-table">
        <thead>
          <tr className="bg-paper border-b border-line">
            <BulkHeadCell bulk={bulk} rows={campaigns} />
            <th className="h-[38px] px-4 text-left font-medium text-meta text-mute">Campaign</th>
            <th className="h-[38px] px-4 text-left font-medium text-meta text-mute">Who it went to</th>
            <th className="h-[38px] px-4 text-right font-medium text-meta text-mute tabular-nums">Sent</th>
            <th className="h-[38px] px-4 text-right font-medium text-meta text-mute tabular-nums">Opened</th>
            <th className="h-[38px] px-4 text-right font-medium text-meta text-mute tabular-nums">Clicked</th>
            <th className="h-[38px] px-4 text-left font-medium text-meta text-mute">What came of it</th>
            <th className="h-[38px] px-4 text-left font-medium text-meta text-mute">State</th>
            <RowMenuHeadCell bulk={bulk} />
          </tr>
        </thead>
        <tbody>
          {campaigns.map((campaign) => (
            <tr key={campaign.id} className="border-b border-hair last:border-b-0" data-testid={`campaign-row-${campaign.id}`}>
              <BulkRowCell bulk={bulk} id={campaign.id} />
              <td className="h-[46px] px-4 font-medium text-sm align-middle">{campaign.name || "—"}</td>
              <td className="h-[46px] px-4 text-sm text-ink-2 align-middle">{campaign.segmentName || "—"}</td>
              <td className="h-[46px] px-4 text-sm text-right tabular-nums align-middle">
                {formatNumber(campaign.sent_count)}
              </td>
              <td
                className="h-[46px] px-4 text-sm text-right tabular-nums align-middle"
                data-testid={`campaign-opened-${campaign.id}`}
              >
                <DisabledWithReason disabled={true} reason="Not collected" testId={`opened-${campaign.id}`}>
                  {({ disabled, describedBy }) => (
                    <span aria-describedby={describedBy}>Not collected</span>
                  )}
                </DisabledWithReason>
              </td>
              <td
                className="h-[46px] px-4 text-sm text-right tabular-nums align-middle"
                data-testid={`campaign-clicked-${campaign.id}`}
              >
                <DisabledWithReason disabled={true} reason="Not collected" testId={`clicked-${campaign.id}`}>
                  {({ disabled, describedBy }) => (
                    <span aria-describedby={describedBy}>Not collected</span>
                  )}
                </DisabledWithReason>
              </td>
              <td className="h-[46px] px-4 text-sm tabular-nums align-middle">
                {campaign.campaignResults || "—"}
              </td>
              <td className="h-[46px] px-4 text-sm align-middle">
                {campaign.state === "sent" && (
                  <span className="inline-flex items-center h-[21px] px-[9px] rounded-[5px] font-medium text-xs bg-ok-soft text-ok">
                    Sent
                  </span>
                )}
                {campaign.state === "draft" && (
                  <span className="inline-flex items-center h-[21px] px-[9px] rounded-[5px] font-medium text-xs bg-mute-bg text-mute">
                    Draft
                  </span>
                )}
                {campaign.state === "scheduled" && (
                  <span className="inline-flex items-center h-[21px] px-[9px] rounded-[5px] font-medium text-xs bg-brand-soft text-brand">
                    Scheduled
                  </span>
                )}
                {!["sent", "draft", "scheduled"].includes(campaign.state) && (
                  <span className="inline-flex items-center h-[21px] px-[9px] rounded-[5px] font-medium text-xs bg-mute-bg text-mute">
                    {campaign.state || "—"}
                  </span>
                )}
              </td>
              <RowMenuCell bulk={bulk} row={campaign} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
