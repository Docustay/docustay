// ═══════════════════════════════════════════════════════════════════════════════════════════════
// WhatsNew — Release notes and Feature log screen.
// Ported from webui/src/lib/screens/whatsnew/WhatsNew.svelte. Two views from one read:
// Release notes shows the newest entry as a poster card, followed by past entries in a dated strip.
// Feature log shows every entry as rows with tag filtering.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState, useMemo } from "react";
import { api, ApiError } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import EmptyState from "@/lib/empty/EmptyState.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import WhatsNewFeatureLogTable from "./WhatsNewFeatureLogTable.jsx";

export default function WhatsNew() {
  // ★ the maintainer, 28 Sep 2026 — react-router-dom was never installed and nothing else in this app uses
  //   it (MEASURED: the only other hit was this file's own story). Every write site here already
  //   called `window.history.replaceState` directly before also calling `setSearchParams` — the
  //   two were doing the same job twice. `viewParam` now just reads the URL on mount and after
  //   each manual history update, with no routing library involved.
  const [viewParam, setViewParam] = useState(() => new URLSearchParams(window.location.search).get("view"));
  const [state, setState] = useState("loading");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [activeTag, setActiveTag] = useState(null);

  const isLogView = viewParam === "log";
  const activeView = isLogView ? "log" : "notes";

  useEffect(() => {
    const fetchData = async () => {
      try {
        const result = await api.whatsNew();
        setData(result);
        if (result.notes && result.notes.length > 0) {
          setState("loaded");
        } else {
          setState("empty");
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          setState("forbidden");
          setError(err);
        } else {
          setState("error");
          setError(err);
        }
      }
    };
    fetchData();
  }, []);

  const filteredNotes = useMemo(() => {
    if (!data?.notes || !activeTag) return data?.notes ?? [];
    return data.notes.filter((note) => note.tags?.includes(activeTag));
  }, [data, activeTag]);

  const latestEntry = useMemo(() => {
    return filteredNotes?.[0] ?? null;
  }, [filteredNotes]);

  const pastEntries = useMemo(() => {
    return filteredNotes?.slice(1) ?? [];
  }, [filteredNotes]);

  const allLogEntries = useMemo(() => {
    return filteredNotes ?? [];
  }, [filteredNotes]);

  const allTags = useMemo(() => {
    const tagSet = new Set();
    data?.notes?.forEach((note) => {
      note.tags?.forEach((tag) => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [data]);

  function handleClearFilters() {
    setActiveTag(null);
  }

  function formatDate(isoDate) {
    const d = new Date(isoDate);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function toggleTag(tag) {
    setActiveTag(activeTag === tag ? null : tag);
  }

  if (state === "loading") {
    return <ScreenState phase="loading" />;
  }

  if (state === "error") {
    return (
      <ScreenState phase="error">
        <ErrorPanel error={error} />
      </ScreenState>
    );
  }

  if (state === "forbidden") {
    return (
      <ScreenState phase="empty">
        <EmptyState
          kind="first-run"
          headline="You don't have access"
          line="This section is for staff only."
          testId="whats-new-forbidden"
        />
      </ScreenState>
    );
  }

  if (isLogView) {
    return (
      <WhatsNewFeatureLogTable
        data={data}
        activeTag={activeTag}
        activeView={activeView}
        filteredNotes={filteredNotes}
        allLogEntries={allLogEntries}
        allTags={allTags}
        handleClearFilters={handleClearFilters}
        formatDate={formatDate}
        toggleTag={toggleTag}
      />
    );
  }

  // Release notes view
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h1 className="m-0 text-4xl font-medium leading-tight text-[var(--color-structure-900)]">Release notes</h1>
        <div className="flex gap-6 border-b border-[var(--color-structure-200)] pb-0">
          <button
            type="button"
            className={`px-0 py-2.5 text-sm font-medium transition-colors ${
              !isLogView
                ? "border-b-2 border-[var(--color-action-600)] text-[var(--color-structure-900)]"
                : "border-b-2 border-transparent text-[var(--color-structure-600)] hover:text-[var(--color-structure-900)]"
            }`}
            onClick={() => {
              const url = new URL(window.location);
              url.searchParams.delete("view");
              window.history.replaceState({}, "", url);
              setViewParam(null);
            }}
            data-testid="whats-new-view-notes"
          >
            Release notes
          </button>
          <button
            type="button"
            className={`px-0 py-2.5 text-sm font-medium transition-colors ${
              isLogView
                ? "border-b-2 border-[var(--color-action-600)] text-[var(--color-structure-900)]"
                : "border-b-2 border-transparent text-[var(--color-structure-600)] hover:text-[var(--color-structure-900)]"
            }`}
            onClick={() => {
              const url = new URL(window.location);
              url.searchParams.set("view", "log");
              window.history.replaceState({}, "", url);
              setViewParam("log");
            }}
            data-testid="whats-new-view-log"
          >
            Feature log
          </button>
        </div>
      </div>

      {filteredNotes.length === 0 ? (
        <ScreenState phase="empty">
          <EmptyState
            kind="first-run"
            headline="Nothing yet"
            line="When something ships, it lands here."
            testId="whats-new-empty"
          />
        </ScreenState>
      ) : (
        <div className="flex flex-col gap-6">
          {/* Poster card: the newest entry */}
          {latestEntry && (
            <div
              className="rounded-2xl border border-[var(--color-border-card)] bg-[var(--color-wash-card)] p-6"
              data-testid={`whats-new-poster-${latestEntry.date}`}
            >
              <div
                className="text-xs text-[var(--color-structure-600)]"
                data-testid={`whats-new-poster-date-${latestEntry.date}`}
              >
                {formatDate(latestEntry.date)}
              </div>
              <h2
                className="m-0 mt-3 mb-3 text-lg font-semibold leading-snug text-[var(--color-structure-900)]"
                data-testid={`whats-new-poster-title-${latestEntry.date}`}
              >
                {latestEntry.title}
              </h2>
              <p
                className="m-0 mb-3 text-sm text-[var(--color-structure-600)] leading-relaxed break-words"
                data-testid={`whats-new-poster-body-${latestEntry.date}`}
              >
                {latestEntry.body}
              </p>
              {latestEntry.tags && latestEntry.tags.length > 0 && (
                <div
                  className="flex flex-wrap gap-2"
                  data-testid={`whats-new-poster-tags-${latestEntry.date}`}
                >
                  {latestEntry.tags.map((tag) => (
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
          )}

          {/* Past entries: dated strip */}
          {pastEntries.length > 0 && (
            <div
              className="flex flex-col"
              data-testid="whats-new-past-strip"
            >
              {pastEntries.map((entry) => (
                <div
                  key={entry.date}
                  className="flex gap-4 border-b border-[var(--color-structure-150)] py-4 last:border-b-0"
                  data-testid={`whats-new-past-entry-${entry.date}`}
                >
                  <div
                    className="flex-shrink-0 text-xs text-[var(--color-structure-600)]"
                    data-testid={`whats-new-past-date-${entry.date}`}
                  >
                    {formatDate(entry.date)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3
                      className="m-0 mb-1 text-sm font-semibold text-[var(--color-structure-900)]"
                      data-testid={`whats-new-past-title-${entry.date}`}
                    >
                      {entry.title}
                    </h3>
                    <p
                      className="m-0 text-xs text-[var(--color-structure-600)] leading-relaxed break-words"
                      data-testid={`whats-new-past-body-${entry.date}`}
                    >
                      {entry.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
