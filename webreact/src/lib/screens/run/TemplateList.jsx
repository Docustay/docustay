// ═══════════════════════════════════════════════════════════════════════════════════════════════
// TemplateList — the email templates list screen. Ported from
// webui/src/lib/screens/run/TemplateList.svelte (234 lines).
// Props: onNavigate (optional). Loads templates data via api.listTemplates.
// Archetype: LedgerPage.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api.js";
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import TemplateListTable1Table from "./TemplateListTable1Table.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";

// ★ the maintainer, 29 Sep 2026 — FOUND LIVE: this list named "booking" and "people", and the real data (
//   src/email/defaultTemplates/index.mjs) has neither — every row's `family` is "bookings"
//   (plural), and there is no "people" family at all. Clicking "Booking" or "People" therefore
//   always filtered to zero rows, silently. Corrected to the eight families that actually occur.
const FAMILY_TABS = [
  { key: "", label: "All" },
  { key: "bookings", label: "Bookings" },
  { key: "money", label: "Money" },
  { key: "documents", label: "Documents" },
  { key: "auth", label: "Sign-in" },
  { key: "automations", label: "Automations" },
  { key: "reports", label: "Reports" },
  { key: "growth", label: "Growth" },
  { key: "support", label: "Support" },
];

export default function TemplateList({ onNavigate = null }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [familyFilter, setFamilyFilter] = useState("");
  // ★ the maintainer, 1 Oct 2026 — FOUND LIVE: the summary and the search placeholder below said "130
  //   templates"/"130 shipped" as a LITERAL STRING, never computed from anything — it was wrong
  //   the day it was written (the real catalogue has never had 130 entries) and every template
  //   added since (receipts, card alerts, plan lifecycle, …) had no way to move a number that was
  //   never a number. Fetched once, unfiltered, so it reads correctly regardless of which family
  //   tab or search term is active.
  const [totalCount, setTotalCount] = useState(null);
  // ★ the maintainer, 1 Oct 2026 — Part 2's pagination ask: 20 per page, Previous/Next, page numbers, a
  //   "Showing X–Y of Z" count. `page` resets to 1 whenever the filter/search changes — staying
  //   on page 4 of a search that now has one result would just show an empty page with no obvious
  //   way back.
  const [page, setPage] = useState(1);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const PAGE_SIZE = 20;

  const loadTemplates = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await api.listTemplates(familyFilter, searchTerm, page);
      setRows(result.rows || []);
      setFilteredTotal(result.total ?? (result.rows || []).length);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setRows([]);
      setFilteredTotal(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, [searchTerm, familyFilter, page]);

  useEffect(() => {
    setPage(1);
  }, [searchTerm, familyFilter]);

  // ★ The grand total (unfiltered) for the summary line and search placeholder — a SEPARATE fetch
  //   from the paginated/filtered `rows` above, fetched once, so it reads correctly regardless of
  //   which family tab, search term or page is active.
  useEffect(() => {
    api.listTemplates("", "", 1).then((r) => setTotalCount(r.total ?? null)).catch(() => {});
  }, []);

  function handleEdit(key) {
    onNavigate?.(`/run/templates/${key ?? "new"}`);
  }

  function handleClearFilters() {
    setSearchTerm("");
    setFamilyFilter("");
  }

  const isFiltered = searchTerm.length > 0 || familyFilter.length > 0;
  const filteredEmpty = isFiltered && rows.length === 0;

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex-1 flex-shrink-0 max-w-70 h-8.5 border border-line rounded-lg flex items-center gap-2 px-2.75 text-control text-mute bg-white">
        <span>⌕</span>
        <input
          type="text"
          placeholder={totalCount === null ? "Search templates" : `Search ${totalCount} templates`}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="flex-1 border-none bg-none text-control text-ink2 placeholder-mute focus:outline-none"
        />
      </div>
      <button className="inline-flex items-center gap-1.75 h-8.5 px-3 border border-line rounded-lg bg-white text-control text-ink2 cursor-pointer hover:bg-surface-2">Edited only ⌄</button>
      <button className="inline-flex items-center gap-1.75 h-8.5 px-3 border border-line rounded-lg bg-white text-control text-ink2 cursor-pointer hover:bg-surface-2">Has versions ⌄</button>
      <div className="flex-1" />
      <button className="inline-flex items-center gap-1.75 h-8.5 px-3 border border-line rounded-lg bg-white text-control text-ink2 cursor-pointer hover:bg-surface-2">Export ⌄</button>
    </div>
  );

  if (error) {
    return (
      <LedgerPage
        title="Templates"
        summary="Every email the practice sends, editable here."
        primary={{ label: "New template", onClick: () => handleEdit(null) }}
        testId="template-list-page"
      >
        <ScreenState phase="error" error={{ message: error }} />
      </LedgerPage>
    );
  }

  return (
    <LedgerPage
      title="Templates"
      summary={filteredEmpty
        ? "Every email the practice sends, editable here."
        : `Every email the practice sends, editable here.${totalCount === null ? "" : ` ${totalCount} shipped; your edits win.`}`}
      primary={{ label: "New template", onClick: () => handleEdit(null) }}
      views={FAMILY_TABS}
      activeView={familyFilter}
      onView={setFamilyFilter}
      controls={controls}
      testId="template-list-page"
      loading={loading}
    >
      {filteredEmpty ? (
        <div className="flex flex-col gap-2">
          <div className="bg-white border border-line rounded-card overflow-hidden">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="h-9.5 px-4 text-left font-medium text-label uppercase text-mute border-b border-line bg-surface-2">Template</th>
                  <th className="h-9.5 px-4 text-left font-medium text-label uppercase text-mute border-b border-line bg-surface-2">Key</th>
                  <th className="h-9.5 px-4 text-left font-medium text-label uppercase text-mute border-b border-line bg-surface-2">Where it's used</th>
                  <th className="h-9.5 px-4 text-left font-medium text-label uppercase text-mute border-b border-line bg-surface-2">Versions</th>
                  <th className="h-9.5 px-4 text-left font-medium text-label uppercase text-mute border-b border-line bg-surface-2">Active</th>
                  <th className="h-9.5 px-4 text-right font-medium text-label uppercase text-mute border-b border-line bg-surface-2"></th>
                </tr>
              </thead>
            </table>
          </div>
          <div className="font-semibold text-label uppercase tracking-wider text-mute mb-1.5">Nothing matches — filtered, not empty</div>
          <div className="bg-white border border-line rounded-card p-6 text-center">
            <div className="font-medium text-subtitle mb-1.75">Nothing matches "{searchTerm}" {familyFilter ? `in ${familyFilter}` : ""}</div>
            <p className="m-0 mx-auto mb-4.5 max-w-46ch text-control text-mute leading-relaxed">Templates are grouped by the area that sends them — this search found none here.</p>
            <button className="inline-flex items-center justify-center gap-2 h-9.5 px-4.25 rounded-lg font-medium text-sm border border-line bg-white text-ink2 cursor-pointer hover:bg-surface-2" onClick={handleClearFilters}>Clear filters</button>
          </div>
        </div>
      ) : (
        <>
          <TemplateListTable1Table rows={rows} handleEdit={handleEdit} />
          <TemplatePagination page={page} total={filteredTotal} pageSize={PAGE_SIZE} onPage={setPage} />
        </>
      )}
    </LedgerPage>
  );
}

// ★ Part 2's own ask: Previous/Next, page numbers, and a count — search and the family tabs keep
//   working across pages because `page` is just one more piece of `loadTemplates`'s own query.
function TemplatePagination({ page, total, pageSize, onPage }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const pageNumbers = Array.from({ length: pageCount }, (_, i) => i + 1);

  return (
    <div className="flex items-center justify-between mt-3 px-1">
      <div className="text-control text-mute">Showing {start}–{end} of {total}</div>
      <div className="flex items-center gap-1">
        <button
          className="inline-flex items-center h-8 px-3 border border-line rounded-lg bg-white text-control text-ink2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer hover:bg-surface-2"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
        >
          Previous
        </button>
        {pageNumbers.map((n) => (
          <button
            key={n}
            className={`inline-flex items-center justify-center h-8 w-8 border rounded-lg text-control cursor-pointer ${
              n === page ? "border-brand bg-brand text-white" : "border-line bg-white text-ink2 hover:bg-surface-2"
            }`}
            onClick={() => onPage(n)}
          >
            {n}
          </button>
        ))}
        <button
          className="inline-flex items-center h-8 px-3 border border-line rounded-lg bg-white text-control text-ink2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer hover:bg-surface-2"
          onClick={() => onPage(page + 1)}
          disabled={page >= pageCount}
        >
          Next
        </button>
      </div>
    </div>
  );
}
