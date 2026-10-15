// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 17.33 — PROMPTFEED. "What needs you" feed: every prompt, filterable, oldest first.
// Home's "Six more things need you" link opens this screen, which mounts WorklistPage with the
// full list of qualifying prompts, filter pills (money hidden for coaches), dismiss with the
// route from CT-F01, and all four empties (first-run, filtered, loading, error).
// Ported from webui/src/lib/screens/home/PromptFeed.svelte: same props, handlers, testids.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { api, request } from "@/lib/api.js";
import WorklistPage from "@/lib/lists/WorklistPage.jsx";
import PromptCard from "@/lib/prompts/PromptCard.jsx";
import EmptyState from "@/lib/empty/EmptyState.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";

const FILTERS = [
  { key: "everything", label: "Everything" },
  { key: "money", label: "Money" },
  { key: "people", label: "People" },
  { key: "documents", label: "Documents" },
  { key: "found", label: "How you're found" },
];

export default function PromptFeed() {
  const [prompts, setPrompts] = useState([]);
  const [summary, setSummary] = useState("");
  const [activeFilter, setActiveFilter] = useState("everything");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dismissing, setDismissing] = useState({});
  const [canSeeMoney, setCanSeeMoney] = useState(false);

  async function loadPrompts(filter = "everything") {
    setLoading(true);
    setError(null);
    setDismissing({});
    try {
      const url = `/api/prompts?surface=feed&filter=${encodeURIComponent(filter)}`;
      const data = await request(url);
      setPrompts(data.prompts || []);
      setSummary(data.summary || "");
      setActiveFilter(filter);
    } catch (e) {
      setError(e);
      setPrompts([]);
      setSummary("");
    } finally {
      setLoading(false);
    }
  }

  async function handleDismiss(kind, subjectId) {
    const key = `${kind}:${subjectId ?? ""}`;
    setDismissing((prev) => ({ ...prev, [key]: true }));

    try {
      await api.dismissPrompt(kind, subjectId);
      // Remove from local list
      setPrompts((prev) => prev.filter((p) => p.kind !== kind || p.subjectId !== subjectId));
    } catch (e) {
      console.error("Failed to dismiss prompt:", e);
    } finally {
      setDismissing((prev) => ({ ...prev, [key]: false }));
    }
  }

  function handleFilterChange(key) {
    loadPrompts(key);
  }

  function handleClearFilters() {
    loadPrompts("everything");
  }

  async function initializeView() {
    try {
      const homeData = await api.home();
      setCanSeeMoney(homeData.view === "owner" || homeData.view === "admin");
    } catch (e) {
      // Silently fail - canSeeMoney defaults to false
      console.error("Failed to load home data:", e);
    }
    loadPrompts("everything");
  }

  useEffect(() => {
    initializeView();
  }, []);

  const visibleFilters = canSeeMoney ? FILTERS : FILTERS.filter((f) => f.key !== "money");

  const hasPrompts = !loading && prompts.length > 0;
  const isEmpty = !loading && prompts.length === 0 && activeFilter === "everything";
  const isFiltered = !loading && prompts.length === 0 && activeFilter !== "everything";
  const isError = !loading && error !== null;
  const isLoading = loading;

  const views = visibleFilters.map((f) => ({
    key: f.key,
    label: f.label,
  }));

  if (isLoading) {
    return <ScreenState phase="loading" />;
  }

  if (isError) {
    return <ScreenState phase="error" error={error} />;
  }

  if (isEmpty) {
    return (
      <WorklistPage
        title="What needs you"
        summary={summary}
        headerAction={{ label: "Notification settings", onClick: () => (window.location.href = "/settings/notifications") }}
        views={views}
        activeView={activeFilter}
        onView={handleFilterChange}
      >
        <EmptyState
          kind="first-run"
          headline="Nothing needs you right now"
          line="Enjoy it — you're all caught up."
          action={{ label: "Check back later", href: "/home" }}
        />
      </WorklistPage>
    );
  }

  if (isFiltered) {
    return (
      <WorklistPage
        title="What needs you"
        summary={summary}
        headerAction={{ label: "Notification settings", onClick: () => (window.location.href = "/settings/notifications") }}
        views={views}
        activeView={activeFilter}
        onView={handleFilterChange}
      >
        <EmptyState
          kind="filtered"
          headline="No prompts match this filter"
          line="Try a different filter to find what you're looking for."
          onClearFilters={handleClearFilters}
        />
      </WorklistPage>
    );
  }

  if (hasPrompts) {
    return (
      <WorklistPage
        title="What needs you"
        summary={summary}
        headerAction={{ label: "Notification settings", onClick: () => (window.location.href = "/settings/notifications") }}
        views={views}
        activeView={activeFilter}
        onView={handleFilterChange}
      >
        <div className="flex flex-col gap-[var(--gap)]" data-testid="prompt-feed-list">
          {prompts.map((prompt) => (
            <PromptCard
              key={prompt.dismissKey}
              icon={prompt.icon}
              tone={prompt.tone}
              headline={prompt.headline}
              why={prompt.why}
              action={prompt.action}
              kind={prompt.kind}
              busy={dismissing[prompt.dismissKey] ?? false}
              onDismiss={() => handleDismiss(prompt.kind, prompt.subjectId)}
              testId="prompt-feed-card"
            />
          ))}
        </div>
      </WorklistPage>
    );
  }

  return null;
}
