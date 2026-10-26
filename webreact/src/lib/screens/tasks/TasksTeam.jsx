// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R7.004 — TasksTeam.jsx — React port of webui/src/lib/screens/tasks/TasksTeam.svelte
// Props: { data, onNavigate, onDone }
// Archetype: LedgerPage
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo } from "react";
import { api, ApiError } from "@/lib/api.js";
import { toast } from "sonner";
import TasksTeamTheTeamSTasksTable from "./TasksTeamTheTeamSTasksTable.jsx";

export default function TasksTeam({ data = null, onNavigate = null, onDone = null }) {
  // ── screen state ─────────────────────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);

  // ── load team tasks ──────────────────────────────────────────────────────────────────────────
  const loadTeamTasks = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.taskList("team");
      setRows(result.rows ?? []);
      setLoading(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setLoading(false);
    }
  };

  // Load on mount
  useEffect(() => {
    loadTeamTasks();
  }, []);

  // ── compute derived state ────────────────────────────────────────────────────────────────────
  // Transform rows to add computed where_it_came_from field
  const displayRows = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        where_it_came_from:
          r.made_automatically === true
            ? "Made automatically"
            : r.written_by
              ? `${r.written_by} wrote it`
              : "—",
      })),
    [rows]
  );

  // Compute summary statistics
  const openCount = useMemo(() => rows.filter((r) => !r.closed_at).length, [rows]);
  const overdueCount = useMemo(
    () => rows.filter((r) => !r.closed_at && r.state === "overdue").length,
    [rows]
  );
  const assigneeSet = useMemo(
    () => new Set(rows.filter((r) => !r.closed_at).map((r) => r.assignee_id).filter(Boolean)),
    [rows]
  );
  const assigneeCount = useMemo(() => assigneeSet.size, [assigneeSet]);

  const summary = useMemo(() => {
    if (openCount === 0) return null;
    // F144 — "1 open between 0 of you. none are overdue." when nothing was assigned
    const overdue = overdueCount === 0 ? "None are overdue." : `${overdueCount} ${overdueCount === 1 ? "is" : "are"} overdue.`;
    const who = assigneeCount === 0 ? ", not given to anyone yet" : assigneeCount === 1 ? ", all with one person" : ` between ${assigneeCount} of you`;
    return `${openCount} open${who}. ${overdue}`;
  }, [openCount, assigneeCount, overdueCount]);

  // Compute prompt card condition: ≥2 overdue write-up tasks
  const overduWriteupTasks = useMemo(
    () =>
      rows.filter(
        (r) =>
          !r.closed_at &&
          r.state === "overdue" &&
          r.topic === "booking.booking.completed" &&
          r.made_automatically === true
      ),
    [rows]
  );
  const showPrompt = useMemo(() => overduWriteupTasks.length >= 2, [overduWriteupTasks.length]);

  // ── handlers ─────────────────────────────────────────────────────────────────────────────────
  const handleMoveToMorning = async () => {
    try {
      await api.saveAutomation("tasks.session_writeup", { config: { due: "next_morning" } });
      toast.success("Reminder moved to the morning after");
    } catch (e) {
      toast.error("Failed to update automation", { description: e?.message });
    }
  };

  const createNewTask = () => {
    toast.info("New task flow coming soon");
  };

  // Compute phase
  const phase = useMemo(() => {
    if (loading) return "loading";
    if (error) return "error";
    if (openCount === 0) return "empty";
    return "ready";
  }, [loading, error, openCount]);

  return (
    <div data-testid="tasks-team" className="flex flex-col w-full p-0">
      <TasksTeamTheTeamSTasksTable
        error={error}
        rows={rows}
        loadTeamTasks={loadTeamTasks}
        displayRows={displayRows}
        overdueCount={overdueCount}
        summary={summary}
        overduWriteupTasks={overduWriteupTasks}
        showPrompt={showPrompt}
        handleMoveToMorning={handleMoveToMorning}
        createNewTask={createNewTask}
        phase={phase}
      />
    </div>
  );
}
