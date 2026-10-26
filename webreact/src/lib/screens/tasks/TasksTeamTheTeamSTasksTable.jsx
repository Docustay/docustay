// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R7.004.T1 — TasksTeamTheTeamSTasksTable — the table at webui/src/lib/screens/tasks/TasksTeam.svelte:89-150
// Extracted from the parent TasksTeam component; renders the LedgerPage with the table
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useMemo } from "react";
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import DataTable from "@/lib/lists/DataTable.jsx";
import PromptCard from "@/lib/prompts/PromptCard.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";

export default function TasksTeamTheTeamSTasksTable({
  error,
  rows,
  loadTeamTasks,
  displayRows,
  overdueCount,
  summary,
  overduWriteupTasks,
  showPrompt,
  handleMoveToMorning,
  createNewTask,
  phase,
}) {
  // Compute whether we should show the table or the empty state within this component
  const tableDisplayRows = useMemo(() => displayRows || [], [displayRows]);

  return (
    <LedgerPage
      title="The team's tasks"
      summary={summary}
      primary={{ label: "New task", onClick: createNewTask }}
      views={[
        { key: "mine", label: "Mine" },
        { key: "team", label: "The team's" },
        { key: "done", label: "Done" },
        { key: "made-automatically", label: "Made automatically" },
      ]}
      activeView="team"
      onView={(view) => {
        // Will be wired by the mounting screen
      }}
    >
      <ScreenState
        phase={phase}
        error={error}
        subject="team tasks"
        onRetry={loadTeamTasks}
        empty={{
          kind: "first-run",
          headline: "Nothing to do",
          line: "Tasks turn up here when you write one, and when Workbench notices something — an invoice going late, a client going quiet, a block running out. You don't have to set any of that up.",
          action: { label: "Write a task", href: "#" },
        }}
        testIds={{ empty: "tasks-team-empty" }}
      >
        <div className="flex flex-col gap-[var(--stack)]">
          {showPrompt && (
            <div className="flex flex-col">
              <PromptCard
                icon="✓"
                tone="ok"
                headline={`${overduWriteupTasks.length} of the ${overdueCount} overdue tasks are session write-ups`}
                why="both were made automatically the evening of the session. If notes are always late, the reminder is landing at the wrong time rather than people ignoring it."
                action={{ label: "Move it to the morning after", onClick: handleMoveToMorning }}
                onDismiss={() => {}}
                testId="tasks-team-prompt"
              />
            </div>
          )}
          <DataTable
            title=""
            rows={tableDisplayRows}
            empty="No tasks for this view"
            columns={[
              { key: "title", label: "Task" },
              { key: "assignee_name", label: "Who" },
              { key: "subject_name", label: "About" },
              { key: "due_at", label: "Due" },
              { key: "where_it_came_from", label: "Where it came from" },
              { key: "state", label: "State" },
            ]}
          />
        </div>
      </ScreenState>
    </LedgerPage>
  );
}
