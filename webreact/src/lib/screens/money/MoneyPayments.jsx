// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R6.045 — MoneyPayments: rebuild from the frame on the archetype
// Ported from webui/src/lib/screens/money/MoneyPayments.svelte; same props, testids and copy.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useContext, useEffect, useMemo, useState } from "react";
import { request } from "@/lib/api.js";
import { matchesProgram } from "@/lib/programs/ProgramFilter.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import MoneyPaymentsPaymentsTable from "./MoneyPaymentsPaymentsTable.jsx";
import useListBulk from "@/lib/lists/useListBulk.jsx";
import { AppStateContext } from "@/lib/app/useAppState.js";

export default function MoneyPayments({ view = null, onNavigate = null }) {
  // the route passes only view + onNavigate; the shell state (rank, refetch signal) comes from context, as RowActions reads it
  const app = useContext(AppStateContext);
  // ★ GET /api/money/payments answers `{ payments: { summary, rows, mirrorAsOf } }` (routes/money.mjs).
  const data = useMemo(() => view?.payments ?? null, [view]);
  // ★ The view's own rows carry no program; the descriptor list (/api/list/money/payments) derives `program_ids` from the
  //   invoice's lines. Same payment_effective ids on both, so they are merged here by id. A failed read just leaves the column empty.
  const [programsById, setProgramsById] = useState({});
  const [programFilter, setProgramFilter] = useState("all");
  useEffect(() => {
    let live = true;
    request("/api/list/money/payments")
      .then((res) => { if (live) setProgramsById(Object.fromEntries((res?.rows ?? []).map((r) => [r.id, r.program_ids ?? []]))); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  const allRows = useMemo(() => (data?.rows ?? []).map((r) => ({ ...r, program_ids: programsById[r.id] ?? [] })), [data, programsById]);
  const rows = useMemo(() => allRows.filter((r) => matchesProgram(programFilter, r.program_ids)), [allRows, programFilter]);
  const summary = useMemo(() => {
    const s = data?.summary;
    if (!s || !s.count) return "No payments recorded yet.";
    const taken = (s.takenMinor / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
    const base = `${s.count} payment${s.count === 1 ? "" : "s"}, ${taken} taken.`;
    return s.failed ? `${base} ${s.failed} failed.` : base;
  }, [data]);

  // §13.3 — selection + bulk Delete come from the shared hook; this screen writes no delete code of its own. `rows` = the ten the table shows.
  const bulk = useListBulk({ app, path: "/money/payments", rank: app?.nav?.rank ?? null, rows: rows.slice(0, 10) });

  if (!view) {
    return <ScreenState phase="loading" />;
  }

  return (
    <div data-testid="money-payments">
      <MoneyPaymentsPaymentsTable onNavigate={onNavigate} rows={rows} summary={summary} bulk={bulk}
        programFilter={programFilter} onProgramFilter={setProgramFilter} hasAnyRows={allRows.length > 0} />
    </div>
  );
}
