// ═══════════════════════════════════════════════════════════════════════════════════════════════
// TasksMine — my tasks screen with pills for filtering, rows grouped by due date, row actions
// Ported from webui/src/lib/screens/tasks/TasksMine.svelte
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo } from "react";
import { api } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import NewTaskSheet from "./NewTaskSheet.jsx";
import { toast } from "sonner";

export default function TasksMine({ app, onNavigate }) {
  const [phase, setPhase] = useState("loading");
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [activeFilter, setActiveFilter] = useState("mine");
  const [searchQuery, setSearchQuery] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);

  const timezone = useMemo(() => app?.tenant?.timezone ?? "UTC", [app?.tenant?.timezone]);

  // Filter rows based on activeFilter and searchQuery
  const visibleRows = useMemo(() => {
    let filtered = rows;

    // Apply pill filter
    if (activeFilter === "team") {
      // Show all tasks (not just "mine")
    } else if (activeFilter === "done") {
      filtered = filtered.filter((r) => r.closed_at);
    } else if (activeFilter === "automated") {
      filtered = filtered.filter((r) => r.made_automatically);
    } else {
      // "mine" - default, show only open tasks
      filtered = filtered.filter((r) => !r.closed_at);
    }

    // Filter by search query in title or about
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((r) =>
        r.title?.toLowerCase().includes(q) ||
        r.about?.toLowerCase().includes(q)
      );
    }

    return filtered;
  }, [rows, activeFilter, searchQuery]);

  // Group rows by due date
  const groupedRows = useMemo(() => {
    const now = new Date();
    const groups = {
      overdue: [],
      today: [],
      tomorrow: [],
      weekday: {},
      nextweek: [],
      nodue: [],
    };

    for (const row of visibleRows) {
      if (!row.due_at) {
        groups.nodue.push(row);
        continue;
      }

      const due = new Date(row.due_at);
      const daysDiff = Math.floor((due - now) / (1000 * 60 * 60 * 24));

      if (daysDiff < 0) {
        groups.overdue.push(row);
      } else if (daysDiff === 0) {
        groups.today.push(row);
      } else if (daysDiff === 1) {
        groups.tomorrow.push(row);
      } else if (daysDiff >= 2 && daysDiff <= 6) {
        const dayName = due.toLocaleDateString("en-US", { weekday: "long" });
        if (!groups.weekday[dayName]) groups.weekday[dayName] = [];
        groups.weekday[dayName].push(row);
      } else if (daysDiff >= 7 && daysDiff <= 13) {
        groups.nextweek.push(row);
      }
    }

    const ordered = [];
    if (groups.overdue.length) ordered.push({ label: "Overdue", rows: groups.overdue });
    if (groups.today.length) ordered.push({ label: "Today", rows: groups.today });
    if (groups.tomorrow.length) ordered.push({ label: "Tomorrow", rows: groups.tomorrow });
    Object.keys(groups.weekday).forEach((day) => {
      ordered.push({ label: day, rows: groups.weekday[day] });
    });
    if (groups.nextweek.length) ordered.push({ label: "Next week", rows: groups.nextweek });
    if (groups.nodue.length) ordered.push({ label: "No due date", rows: groups.nodue });

    return ordered;
  }, [visibleRows]);

  // Compute summary counts
  const totalCount = rows.length;
  const automatedCount = rows.filter((r) => r.made_automatically).length;
  const summaryText = useMemo(() => {
    const open = rows.filter((r) => !r.closed_at).length;
    let text = `${pluralize(open, "open")}`;
    if (automatedCount > 0) text += `. ${pluralize(automatedCount, "came")} from Workbench noticing something.`;
    return text;
  }, [rows, automatedCount]);

  function pluralize(count, word) {
    const nums = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
    if (word === "open") return (count <= 12 ? nums[count] : `${count}`) + " open";
    if (word === "came") return (count <= 12 ? nums[count] : `${count}`) + " came";
    return count.toString();
  }

  // Load task list
  async function loadTasks() {
    setPhase("loading");
    setError(null);
    try {
      const data = await api.taskList("mine");
      setRows(data?.rows ?? []);
      setPhase(data?.rows?.length === 0 && activeFilter === "mine" ? "empty" : "ready");
    } catch (err) {
      setError(err);
      setPhase("error");
    }
  }

  // Row actions
  async function handleDone(row) {
    try {
      await api.completeTask({ taskId: row.id });
      setRows(rows.map((r) => (r.id === row.id ? { ...r, closed_at: new Date().toISOString() } : r)));
      toast.success("Task marked done");
    } catch (err) {
      toast.error("Failed to mark task done", { description: err?.message });
    }
  }

  async function handleSnooze(row) {
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      await api.snoozeTask({ taskId: row.id, until: tomorrow.toISOString() });
      setRows(rows.map((r) => (r.id === row.id ? { ...r, due_at: tomorrow.toISOString() } : r)));
      toast.success("Task snoozed");
    } catch (err) {
      toast.error("Failed to snooze task", { description: err?.message });
    }
  }

  async function handleReassign(row) {
    toast.info("Reassign coming soon");
  }

  function handleOpenSubject(row) {
    if (row.subject_type && row.subject_id) {
      onNavigate?.(`/record/${row.subject_type}/${row.subject_id}`);
    }
  }

  function handleNewTask() {
    setSheetOpen(true);
  }

  function handleSheetCancel() {
    setSheetOpen(false);
  }

  async function handleSheetSave(data) {
    try {
      await api.createTask(data);
      setSheetOpen(false);
      await loadTasks();
      toast.success("Task created");
    } catch (err) {
      toast.error("Failed to create task", { description: err?.message });
      throw err;
    }
  }

  function handleClearFilters() {
    setActiveFilter("mine");
    setSearchQuery("");
  }

  // Load on mount
  useEffect(() => {
    loadTasks();
  }, []);

  return (
    <>
      <ScreenState
        phase={phase}
        error={error}
        empty={{
          kind: "first-run",
          headline: "Nothing waiting on you.",
          line: "Tasks turn up here when you write one, and when Workbench notices something — an invoice going late, a client going quiet, a block running out. You don't have to set any of that up.",
        }}
        onNavigate={onNavigate}
        onClearFilters={handleClearFilters}
        testIds={{ empty: "tasks-mine-empty" }}
      >
        <div className="flex flex-col gap-4 px-7.5 py-6.5" data-testid="tasks-mine">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="m-0 font-medium text-2xl font-serif tracking-tight">Tasks</h1>
              <p className="mt-1 text-sm text-mute">{summaryText}</p>
            </div>
            <button
              onClick={handleNewTask}
              className="inline-flex items-center justify-center h-9.5 px-4.25 rounded-control border border-transparent bg-brand text-white font-medium text-sm hover:bg-brand/90 active:translate-y-px disabled:opacity-50 disabled:pointer-events-none"
            >
              New task
            </button>
          </div>

          <div className="flex gap-2 flex-wrap">
            {["mine", "team", "done", "automated"].map((pill) => (
              <button
                key={pill}
                onClick={() => setActiveFilter(pill)}
                className={`inline-flex items-center gap-2 h-8.5 px-3 rounded-control border text-sm font-medium transition-colors ${
                  activeFilter === pill
                    ? "border-brand bg-brand-soft text-brand"
                    : "border-line bg-white text-ink2 hover:border-ink-muted"
                }`}
              >
                {pill === "mine" ? "Mine" : pill === "team" ? "The team's" : pill === "done" ? "Done" : "Made automatically"}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="⌕ Search"
              className="flex-1 max-w-xs h-8.5 px-2.75 rounded-control border border-line bg-white text-sm outline-none focus:border-brand focus:ring-3 focus:ring-brand-soft"
            />
          </div>

          {groupedRows.length > 0 && (
            <div className="bg-white border border-line rounded-2xl overflow-hidden">
              <div className="grid grid-cols-[74px_1fr_140px_120px_80px] gap-4 px-4 h-9 items-center border-b border-line bg-surface text-xs font-medium text-mute">
                <div>When</div>
                <div>What</div>
                <div>Where it came from</div>
                <div>Client</div>
                <div></div>
              </div>

              {groupedRows.map((group) => (
                <div key={group.label}>
                  <div className="px-4 py-2.5 text-xs font-medium text-mute bg-surface border-b border-line">
                    {group.label}
                  </div>
                  {group.rows.map((row) => (
                    <div
                      key={row.id}
                      className="grid grid-cols-[74px_1fr_140px_120px_80px] gap-4 px-4 py-2.75 items-center border-b border-hair h-10 text-sm last:border-b-0"
                    >
                      <div className="text-xs text-mute">
                        <span
                          className={`inline-flex items-center h-6 px-2.25 rounded-full text-xs font-medium ${
                            row.due_at && new Date(row.due_at) < new Date()
                              ? "bg-danger-50 text-danger-700"
                              : "bg-warning-50 text-warning-700"
                          }`}
                        >
                          {row.due_at
                            ? new Date(row.due_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                            : "—"}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium truncate">{row.title}</div>
                        <div className="text-xs text-mute mt-0.5">
                          {row.made_automatically && "Made automatically"}
                          {row.about && row.made_automatically && " · "}
                          {row.about && row.about}
                        </div>
                      </div>
                      <div className="text-sm text-ink2">{row.subject_type ?? "—"}</div>
                      <div className="text-sm text-ink2">{row.person_name ?? "—"}</div>
                      <div className="text-right">
                        <button
                          className="text-xs text-brand hover:underline"
                          onClick={() => handleDone(row)}
                          title="Mark done"
                        >
                          ✓
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </ScreenState>

      {sheetOpen && (
        <NewTaskSheet
          onCancel={handleSheetCancel}
          onSave={handleSheetSave}
        />
      )}
    </>
  );
}
