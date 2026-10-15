// ═══════════════════════════════════════════════════════════════════════════════════════════════
// TASK 20.33 — SetAutomations: automations catalogue with family groups, search, and toggles.
// Ported from webui/src/lib/screens/settings/SetAutomations.svelte
//
// ★★★ The 191-entry catalogue is grouped by family, searchable, and renders per-row:
// - name / one-line description
// - toggle (disabled for ~40 locked rows with "This one is legal or money. It can't be switched off.")
// - locked badge (where applicable)
// - last ran (from automation_run)
//
// ★ Grouped by family: Money, Booking, People, Documents, Items, Growth, Tasks, Calendar, From the platform.
// ★ Filtered-to-nothing renders with a "Clear filters" button, NOT the first-run empty (the five-kinds law).
// ★ Toggle fires once, on toggle. Locked row shows DisabledWithReason with the exact sentence.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { useState, useMemo } from "react";
import { api, ApiError } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";
import { AUTOMATIONS } from "@keystone/automations/catalogue.mjs";

export default function SetAutomations({ data = null, onNavigate = null, onDone = null }) {
  const automations = useMemo(() => data?.automations ?? [], [data?.automations]);
  const settings = useMemo(() => data?.settings ?? {}, [data?.settings]);

  const [searchText, setSearchText] = useState("");
  const [busy, setBusy] = useState({});
  const [problem, setProblem] = useState(null);

  // Map entries by key for quick lookup
  const catalogueByKey = useMemo(() => new Map(AUTOMATIONS.map(a => [a.key, a])), []);

  // Group automations by family
  const grouped = useMemo(() => {
    const groups = new Map();
    const search = searchText.toLowerCase();

    automations.forEach(auto => {
      const entry = catalogueByKey.get(auto.id);
      if (!entry) return;

      // Apply search filter
      if (search && !auto.name.toLowerCase().includes(search) && !entry.line?.toString().includes(search)) {
        return;
      }

      const fam = entry.family;
      if (!groups.has(fam)) groups.set(fam, []);
      groups.get(fam).push(auto);
    });

    // Sort families for display
    const order = ["money", "booking", "people", "documents", "items", "growth", "tasks", "calendar", "workbench"];
    const sorted = [];
    for (const fam of order) {
      if (groups.has(fam)) sorted.push([fam, groups.get(fam)]);
    }
    for (const [fam, rows] of groups) {
      if (!order.includes(fam)) sorted.push([fam, rows]);
    }
    return sorted;
  }, [automations, catalogueByKey, searchText]);

  const hasResults = grouped.some(([, rows]) => rows.length > 0);

  async function toggleAutomation(key) {
    setBusy(prev => ({ ...prev, [key]: true }));
    try {
      const entry = catalogueByKey.get(key);
      if (entry.locked) {
        setProblem("This one is legal or money. It can't be switched off.");
        return;
      }

      const current = automations.find(a => a.id === key);
      const newEnabled = !current.enabled;

      await api.setAutomation(key, { enabled: newEnabled });
      onDone?.();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setProblem(err.message);
      } else {
        setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
      }
    } finally {
      setBusy(prev => ({ ...prev, [key]: false }));
    }
  }

  function clearSearch() {
    setSearchText("");
  }

  function formatLastRan(monthCount) {
    if (!monthCount) return "—";
    return monthCount === 1 ? "1 time" : monthCount + " times";
  }

  return (
    <section className="flex w-full flex-col gap-6 px-[30px] py-[26px]" data-testid="set-automations">
      <div className="flex flex-col gap-2">
        <h1 className="m-0 font-fraunces text-2xl font-medium leading-tight text-ink -tracking-[0.01em]">
          Automations
        </h1>
        <p className="m-0 text-base font-normal leading-relaxed text-ink-2">
          Keep clients and your team in the loop automatically.
        </p>
      </div>

      {problem && (
        <ErrorPanel error={problem} onDismiss={() => setProblem(null)} />
      )}

      <div className="flex">
        <input
          type="text"
          placeholder="Search automations…"
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          className="h-9 w-full max-w-xs rounded-lg border border-line bg-surface px-3 py-0 text-sm font-normal text-ink placeholder-placeholder focus:outline-none focus:ring-2 focus:ring-brand"
          data-testid="automations-search"
        />
      </div>

      {!hasResults && searchText ? (
        <div className="rounded-lg border border-line bg-paper p-10 text-center" data-testid="automations-filtered-empty">
          <p className="m-0 mb-4 text-base font-normal text-ink">No automations match your search.</p>
          <button
            className="inline-flex h-9 items-center rounded-lg border border-line bg-surface px-4 py-0 text-sm font-medium text-brand hover:border-brand hover:bg-brand-soft focus:outline-none focus:ring-2 focus:ring-brand"
            onClick={clearSearch}
            data-testid="clear-search"
          >
            Clear filters
          </button>
        </div>
      ) : grouped.length === 0 ? (
        <ScreenState phase="loading" />
      ) : (
        <div className="flex flex-col gap-6">
          {grouped.map(([family, rows]) => (
            <div key={family} data-testid={`automation-group-${family}`}>
              <div className="mb-3">
                <h2 className="m-0 text-base font-medium text-ink capitalize">{family}</h2>
              </div>

              <div className="overflow-hidden rounded-lg border border-line bg-surface">
                {rows.map((auto, idx) => {
                  const entry = catalogueByKey.get(auto.id);
                  return (
                    <div
                      key={auto.id}
                      className={`flex items-center justify-between gap-4 border-b border-line px-4 py-4 ${
                        entry.locked ? "bg-paper opacity-70" : ""
                      } ${idx === rows.length - 1 ? "border-b-0" : ""}`}
                      data-testid={`automation-row-${auto.id}`}
                    >
                      <div className="flex-1">
                        <div className="text-sm font-medium text-ink">{auto.name}</div>
                        <div className="mt-1.5 flex items-center gap-3 text-xs font-normal text-ink-2">
                          {entry.locked && (
                            <span
                              className="inline-flex items-center rounded px-2 py-1 text-xs font-medium bg-warn-soft text-warn"
                              data-testid={`locked-badge-${auto.id}`}
                            >
                              Locked
                            </span>
                          )}
                          <span data-testid={`last-ran-${auto.id}`}>
                            Ran {formatLastRan(auto.month_count)} this month
                          </span>
                        </div>
                      </div>

                      <div className="flex-shrink-0">
                        {entry.locked ? (
                          <DisabledWithReason
                            disabled={true}
                            reason="This one is legal or money. It can't be switched off."
                            testId={`locked-row-${auto.id}`}
                          >
                            {({ disabled, describedBy }) => (
                              <Switch
                                checked={auto.enabled}
                                disabled={true}
                                data-testid={`automation-toggle-${auto.id}`}
                                aria-describedby={describedBy}
                              />
                            )}
                          </DisabledWithReason>
                        ) : (
                          <Switch
                            checked={auto.enabled}
                            onCheckedChange={() => toggleAutomation(auto.id)}
                            disabled={busy[auto.id]}
                            data-testid={`automation-toggle-${auto.id}`}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
