// ═══════════════════════════════════════════════════════════════════════════════════════════════
// WhatsNewFeatureLogTable — the table inside the Feature log view.
// Ported from webui/src/lib/screens/whatsnew/WhatsNew.svelte:114-194. Uses LedgerPage, EmptyState,
// ScreenState kit components; receives already-filtered rows and tag state from parent.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import EmptyState from "@/lib/empty/EmptyState.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";

export default function WhatsNewFeatureLogTable({
  data,
  activeTag,
  activeView,
  filteredNotes,
  allLogEntries,
  allTags,
  handleClearFilters,
  formatDate,
  toggleTag,
}) {
  return (
    <LedgerPage
      title="Feature log"
      views={[
        { key: "notes", label: "Release notes" },
        { key: "log", label: "Feature log" },
      ]}
      activeView={activeView}
      onView={(key) => {
        const url = new URL(window.location);
        if (key === "notes") {
          url.searchParams.delete("view");
        } else {
          url.searchParams.set("view", "log");
        }
        window.history.replaceState({}, "", url);
      }}
      controls={
        <div className="flex flex-wrap gap-2">
          {allTags.map((tag) => (
            <button
              key={tag}
              className={`rounded-2xl border px-3 py-1.5 text-xs font-medium transition-all ${
                activeTag === tag
                  ? "border-[var(--color-action-600)] bg-[var(--color-action-600)] text-[var(--color-structure-0)]"
                  : "border-[var(--color-structure-200)] bg-[var(--color-structure-0)] text-[var(--color-structure-900)] hover:border-[var(--color-action-600)] hover:text-[var(--color-action-600)]"
              }`}
              onClick={() => toggleTag(tag)}
              data-testid={`whats-new-filter-${tag}`}
            >
              {tag}
            </button>
          ))}
        </div>
      }
    >
      {filteredNotes.length === 0 ? (
        <ScreenState phase="empty">
          {activeTag ? (
            <EmptyState
              kind="filtered"
              headline="No entries match"
              line={`No entries have the "${activeTag}" tag.`}
              onClearFilters={handleClearFilters}
              testId="whats-new-filtered-empty"
            />
          ) : (
            <EmptyState
              kind="first-run"
              headline="Nothing yet"
              line="When something ships, it lands here."
              testId="whats-new-empty"
            />
          )}
        </ScreenState>
      ) : (
        <div className="flex flex-col border-t border-[var(--color-structure-200)]">
          {allLogEntries.map((entry) => (
            <div
              key={entry.date}
              className="flex gap-4 border-b border-[var(--color-structure-150)] py-4 last:border-b-0"
              data-testid={`whats-new-entry-${entry.date}`}
            >
              <div
                className="flex-shrink-0 text-xs text-[var(--color-structure-600)]"
                data-testid={`whats-new-date-${entry.date}`}
              >
                {formatDate(entry.date)}
              </div>
              <div className="flex-1 min-w-0">
                <h3
                  className="m-0 mb-1 text-sm font-semibold text-[var(--color-structure-900)]"
                  data-testid={`whats-new-title-${entry.date}`}
                >
                  {entry.title}
                </h3>
                <p
                  className="m-0 mb-2 text-xs text-[var(--color-structure-600)] leading-relaxed break-words"
                  data-testid={`whats-new-body-${entry.date}`}
                >
                  {entry.body}
                </p>
                {entry.tags && entry.tags.length > 0 && (
                  <div
                    className="flex flex-wrap gap-1.5"
                    data-testid={`whats-new-tags-${entry.date}`}
                  >
                    {entry.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-block rounded-3xl bg-[var(--color-chip-neutral-bg)] px-2 py-1 text-2xs font-medium uppercase text-[var(--color-chip-neutral-ink)]"
                        data-testid={`whats-new-tag-${tag}`}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </LedgerPage>
  );
}
