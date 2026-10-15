import { useState, useEffect } from "react";
import { api, ApiError } from "@/lib/api.js";
import { Button } from "@/lib/components/ui/button.jsx";
import RowActions from "@/lib/lists/RowActions.jsx";
import {
  Field,
  FieldLabel,
  FieldContent,
  FieldGroup,
  FieldError,
} from "@/lib/components/ui/field.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Textarea } from "@/lib/components/ui/textarea.jsx";
import { Skeleton } from "@/lib/components/ui/skeleton.jsx";
import EmptyState from "@/lib/empty/EmptyState.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";

const STATE_TONE = { now: "act", parked: "neutral", done: "ok" };

const SECTIONS = [
  { key: "rightNow", state: "now", label: "Right now" },
  { key: "parked", state: "parked", label: "Parked" },
  { key: "done", state: "done", label: "Done" },
];

const STATE_LABELS = { now: "Working on it", parked: "Parked", done: "Settled" };

export default function PersonGoalsTab({ personId, payerName = null }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [denied, setDenied] = useState(false);
  const [deniedMessage, setDeniedMessage] = useState(null);
  const [goals, setGoals] = useState({
    rightNow: [],
    parked: [],
    done: [],
  });

  const [addTitle, setAddTitle] = useState("");
  const [addDetail, setAddDetail] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState(null);

  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDetail, setEditDetail] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState(null);

  const [moveBusyId, setMoveBusyId] = useState(null);
  const [moveError, setMoveError] = useState(null);

  const allEmpty =
    (goals.rightNow?.length ?? 0) === 0 &&
    (goals.parked?.length ?? 0) === 0 &&
    (goals.done?.length ?? 0) === 0;

  async function load() {
    if (!personId) return;
    setLoading(true);
    setError(null);
    setDenied(false);
    setDeniedMessage(null);
    try {
      const data = await api.personGoals(personId);
      setGoals(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setDenied(true);
        setDeniedMessage(err.message);
      } else {
        setError(err);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (personId) load();
  }, [personId]);

  async function submitAdd() {
    setAddError(null);
    const title = addTitle.trim();
    if (!title) {
      setAddError("Title is required.");
      return;
    }
    setAddBusy(true);
    try {
      const { id } = await api.createGoal(personId, {
        title,
        detail: addDetail.trim() || null,
      });
      setGoals({
        ...goals,
        rightNow: [
          {
            id,
            title,
            detail: addDetail.trim() || null,
            state: "now",
            stateChangedAt: new Date().toISOString(),
          },
          ...goals.rightNow,
        ],
      });
      setAddTitle("");
      setAddDetail("");
    } catch (err) {
      setAddError(
        err instanceof ApiError ? err.message : String(err?.message ?? err)
      );
    } finally {
      setAddBusy(false);
    }
  }

  function startEdit(goal) {
    setEditingId(goal.id);
    setEditTitle(goal.title);
    setEditDetail(goal.detail ?? "");
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  function patchInPlace(goalId, patch) {
    const next = { ...goals };
    for (const sec of SECTIONS) {
      next[sec.key] = (goals[sec.key] ?? []).map((g) =>
        g.id === goalId ? { ...g, ...patch } : g
      );
    }
    setGoals(next);
  }

  async function submitEdit(goal) {
    setEditError(null);
    const title = editTitle.trim();
    if (!title) {
      setEditError("Title is required.");
      return;
    }
    setEditBusy(true);
    try {
      const detail = editDetail.trim() || null;
      await api.updateGoal(goal.id, { title, detail });
      patchInPlace(goal.id, { title, detail });
      setEditingId(null);
    } catch (err) {
      setEditError(
        err instanceof ApiError ? err.message : String(err?.message ?? err)
      );
    } finally {
      setEditBusy(false);
    }
  }

  function moveLocal(goalId, toState) {
    let moved = null;
    const next = {};
    for (const sec of SECTIONS) {
      next[sec.key] = (goals[sec.key] ?? []).filter((g) => {
        if (g.id === goalId) {
          moved = { ...g, state: toState, stateChangedAt: new Date().toISOString() };
          return false;
        }
        return true;
      });
    }
    if (moved) {
      const destKey = SECTIONS.find((s) => s.state === toState).key;
      next[destKey] = [moved, ...next[destKey]];
    }
    setGoals(next);
  }

  async function moveGoal(goal, toState) {
    setMoveBusyId(goal.id);
    setMoveError(null);
    try {
      await api.updateGoal(goal.id, { state: toState });
      moveLocal(goal.id, toState);
    } catch (err) {
      setMoveError({
        goalId: goal.id,
        message:
          err instanceof ApiError ? err.message : String(err?.message ?? err),
      });
    } finally {
      setMoveBusyId(null);
    }
  }

  function actionsFor(goal) {
    const moves = SECTIONS.filter((s) => s.state !== goal.state).map((s) => ({
      id: `move-${s.state}`,
      label: `Move to ${STATE_LABELS[s.state]}`,
      onRun: () => moveGoal(goal, s.state),
    }));
    return [...moves, { id: "edit", label: "Edit", onRun: () => startEdit(goal) }];
  }

  return (
    <div data-testid="person-goals-tab">
      {loading ? (
        <div className="flex flex-col gap-3" data-testid="goals-loading" aria-busy="true">
          <Skeleton className="h-16 rounded-card" />
          <Skeleton className="h-16 rounded-card" />
          <Skeleton className="h-16 rounded-card" />
          <p role="status" className="sr-only">Loading…</p>
        </div>
      ) : denied ? (
        <div className="rounded-card border border-line bg-surface p-14 text-center" data-state="denied" data-testid="goals-denied" role="status">
          <p className="m-0 text-empty-title font-medium text-ink">You do not have access to this.</p>
          <p className="mx-auto mt-2 max-w-[46ch] text-ui text-mute">
            {deniedMessage ??
              "Your role does not include this person's goals. An administrator of this practice can change that."}
          </p>
        </div>
      ) : error ? (
        <ErrorPanel
          error={error}
          subject="Goals"
          onRetry={load}
          variant="band"
          testId="goals-error"
        />
      ) : (
        <div className="flex items-start gap-5.5">
          <div className="min-w-0 flex-1">
            <section className="mb-4.5 rounded-card border border-line bg-surface px-4.25 py-3.5" data-testid="goals-add">
              <h2 className="m-0 mb-3 text-heading font-medium">Add a goal</h2>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="goal-add-title">Title</FieldLabel>
                  <FieldContent>
                    <Input
                      id="goal-add-title"
                      value={addTitle}
                      onChange={(e) => setAddTitle(e.target.value)}
                      placeholder="e.g. Sunday evenings"
                      disabled={addBusy}
                      data-testid="goals-add-title"
                    />
                  </FieldContent>
                </Field>
                <Field>
                  <FieldLabel htmlFor="goal-add-detail">Detail</FieldLabel>
                  <FieldContent>
                    <Textarea
                      id="goal-add-detail"
                      value={addDetail}
                      onChange={(e) => setAddDetail(e.target.value)}
                      placeholder="What's going on, in their own words"
                      disabled={addBusy}
                      data-testid="goals-add-detail"
                    />
                  </FieldContent>
                </Field>
                {addError && (
                  <FieldError data-testid="goals-add-error">
                    {addError}
                  </FieldError>
                )}
              </FieldGroup>
              <div className="mt-3 flex justify-end">
                <Button
                  type="button"
                  disabled={addBusy}
                  onClick={submitAdd}
                  data-testid="goals-add-save"
                >
                  {addBusy ? "Saving…" : "Save"}
                </Button>
              </div>
            </section>

            {allEmpty ? (
              <EmptyState
                kind="first-run"
                headline="Nothing yet"
                line="Add what they're working on"
                testId="goals-empty"
              />
            ) : (
              <>
                {SECTIONS.map((sec) =>
                  goals[sec.key]?.length ? (
                    <section
                      key={sec.key}
                      className="mb-4.5 rounded-card border border-line bg-surface"
                      data-testid={`goals-section-${sec.key}`}
                    >
                      <h2 className="m-0 border-b border-hair px-4.25 py-3.5 text-heading font-medium">
                        {sec.label}
                      </h2>
                      <ul className="m-0 list-none px-4.25 pt-1.5 pb-3.5">
                        {goals[sec.key].map((goal) => (
                          <li
                            key={goal.id}
                            className="flex items-center gap-3 border-b border-hair py-2.75 text-ui last:border-b-0"
                            data-testid={`goals-row-${goal.id}`}
                          >
                            {editingId === goal.id ? (
                              <div
                                className="flex w-full flex-col gap-2 py-2"
                                data-testid={`goals-edit-${goal.id}`}
                              >
                                <FieldGroup>
                                  <Field>
                                    <FieldLabel
                                      htmlFor={`goal-edit-title-${goal.id}`}
                                    >
                                      Title
                                    </FieldLabel>
                                    <FieldContent>
                                      <Input
                                        id={`goal-edit-title-${goal.id}`}
                                        value={editTitle}
                                        onChange={(e) =>
                                          setEditTitle(e.target.value)
                                        }
                                        disabled={editBusy}
                                        data-testid={`goals-edit-title-${goal.id}`}
                                      />
                                    </FieldContent>
                                  </Field>
                                  <Field>
                                    <FieldLabel
                                      htmlFor={`goal-edit-detail-${goal.id}`}
                                    >
                                      Detail
                                    </FieldLabel>
                                    <FieldContent>
                                      <Textarea
                                        id={`goal-edit-detail-${goal.id}`}
                                        value={editDetail}
                                        onChange={(e) =>
                                          setEditDetail(e.target.value)
                                        }
                                        disabled={editBusy}
                                        data-testid={`goals-edit-detail-${goal.id}`}
                                      />
                                    </FieldContent>
                                  </Field>
                                  {editError && (
                                    <FieldError
                                      data-testid={`goals-edit-error-${goal.id}`}
                                    >
                                      {editError}
                                    </FieldError>
                                  )}
                                </FieldGroup>
                                <div className="flex justify-end gap-2">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    disabled={editBusy}
                                    onClick={cancelEdit}
                                    data-testid={`goals-edit-cancel-${goal.id}`}
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    type="button"
                                    disabled={editBusy}
                                    onClick={() => submitEdit(goal)}
                                    data-testid={`goals-edit-save-${goal.id}`}
                                  >
                                    {editBusy ? "Saving…" : "Save"}
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div className="flex min-w-0 flex-1 flex-col">
                                  <span className="text-ui text-ink">
                                    {goal.title}
                                  </span>
                                  {goal.detail && (
                                    <span className="mt-0.5 text-caption text-mute">
                                      {goal.detail}
                                    </span>
                                  )}
                                  {moveBusyId === goal.id && (
                                    <span className="mt-0.5 text-caption text-mute italic">
                                      Moving…
                                    </span>
                                  )}
                                  {moveError?.goalId === goal.id && (
                                    <p
                                      className="mt-1 text-meta text-bad"
                                      role="alert"
                                      data-testid={`goals-move-error-${goal.id}`}
                                    >
                                      {moveError.message}
                                    </p>
                                  )}
                                </div>
                                <StatusBadge
                                  label={STATE_LABELS[goal.state]}
                                  tone={STATE_TONE[goal.state]}
                                  testId={`goals-chip-${goal.id}`}
                                />
                                <RowActions
                                  actions={actionsFor(goal)}
                                  row={goal}
                                />
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null
                )}
              </>
            )}
          </div>

          <aside
            className="w-80 flex-shrink-0 rounded-card border border-line bg-surface"
            aria-label="How this works"
            data-testid="goals-rail"
          >
            <h2 className="m-0 border-b border-hair px-4.25 py-3.5 text-heading font-medium">How this works</h2>
            <div className="flex flex-col px-4.25 pt-1.5 pb-3.5" data-testid="goals-rail-payer">
              <span className="text-ui text-ink">
                Nobody who pays can
              </span>
              <span className="mt-0.5 text-caption text-mute">
                {payerName ?? "Whoever pays"} sees attendance and money only.
              </span>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
