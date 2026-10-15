// ═══════════════════════════════════════════════════════════════════════════════════════════════
// MONEY › CREDITS › TABLE — R6.039.T1
// Subtask: the table component extracted from MoneyCredits (webui lines 115-172)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import DataTable from "@/lib/lists/DataTable.jsx";
import PromptCard from "@/lib/prompts/PromptCard.jsx";

export default function MoneyCreditsCreditsTable({
  onNavigate,
  summary,
  credits,
  formatMoney,
  summaryText,
  expiringCount,
  expiringWorthMinor,
  columns,
}) {
  return (
    <LedgerPage
      title="Credits"
      summary={summaryText}
      onNavigate={onNavigate}
      testId="money-credits-table"
    >
      <DataTable
        title=""
        rows={credits}
        columns={columns}
        empty="No credits match your filters."
      />

      {/* Worth doing section */}
      {expiringCount > 0 && (
        <div className="mt-4.5">
          <div className="mb-3 text-sm font-medium text-ink">Worth doing</div>
          <PromptCard
            icon="$"
            tone="money"
            headline={`${expiringCount} ${expiringCount === 1 ? "person has" : "people have"} sessions expiring within a month`}
            why={`${expiringCount === 1 ? "one session worth" : `${expiringCount} sessions worth`} ${formatMoney(expiringWorthMinor)} ${expiringCount === 1 ? "is" : "are"} at risk. ${expiringCount === 1 ? "This person hasn't" : "None of them have"} been told.`}
            action={{
              label: `Tell all ${expiringCount > 1 ? expiringCount : ""}`.trim(),
              onClick: () => {},
            }}
          />
        </div>
      )}
    </LedgerPage>
  );
}
