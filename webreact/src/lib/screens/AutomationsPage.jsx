// ═══════════════════════════════════════════════════════════════════════════════════════════════
// AutomationsPage — the automations list screen. Ported from
// webui/src/lib/screens/AutomationsPage.svelte (349 lines).
// Props: onNavigate. Loads automations data via api.automations and api.saveAutomation.
// Archetype: LedgerPage (via AutomationsPageAutomationsPageTable subtask).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api.js";
import AutomationsPageAutomationsPageTable from "./AutomationsPageAutomationsPageTable.jsx";

export default function AutomationsPage({ onNavigate = null }) {
  const [automations, setAutomations] = useState([]);
  const [totalRanThisMonth, setTotalRanThisMonth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [denied, setDenied] = useState(false);
  const [deniedReason, setDeniedReason] = useState(null);
  const [savingKey, setSavingKey] = useState(null);

  const loadAutomations = async () => {
    try {
      setLoading(true);
      setError(null);
      setDenied(false);
      setDeniedReason(null);
      const response = await api.automations();
      setAutomations(response.automations ?? response ?? []);
      setTotalRanThisMonth(response.ran_this_month ?? 0);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        // ★ the maintainer, 1 Oct 2026 — owner-access audit: this used to set a bare boolean and the table
        //   component hardcoded "ask an owner or admin" regardless of what actually refused the
        //   request — nonsensical on the one person who IS the owner, and useless for finding the
        //   real cause the next time this fires for anyone. The server's own message is specific
        //   (e.g. "requires admin or higher") — show it.
        setDenied(true);
        setDeniedReason(err.message || null);
      } else {
        setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAutomations();
  }, []);

  const runningCount = automations.filter((a) => a.enabled).length;
  const totalActions = totalRanThisMonth;
  const runningAutomations = automations.filter((a) => a.enabled);
  const offAutomations = automations.filter((a) => !a.enabled);

  function spellOut(n) {
    const words = [
      "",
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
      "seven",
      "eight",
      "nine",
      "ten",
      "eleven",
      "twelve",
    ];
    return n <= 12 ? words[n] : String(n);
  }

  const headlineNumber = spellOut(runningCount);

  const enableReviewAsk = async () => {
    if (savingKey) return;
    setSavingKey("run.review_ask");
    try {
      await api.saveAutomation("run.review_ask", {
        enabled: true,
        config: { after_sessions: 1 },
      });
      await loadAutomations();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setSavingKey(null);
    }
  };

  function handleRowClick(key) {
    onNavigate?.(`/tasks/automations/${key}`);
  }

  return (
    <AutomationsPageAutomationsPageTable
      automations={automations}
      loading={loading}
      error={error}
      denied={denied}
      deniedReason={deniedReason}
      savingKey={savingKey}
      totalActions={totalActions}
      runningAutomations={runningAutomations}
      offAutomations={offAutomations}
      headlineNumber={headlineNumber}
      enableReviewAsk={enableReviewAsk}
      handleRowClick={handleRowClick}
    />
  );
}
