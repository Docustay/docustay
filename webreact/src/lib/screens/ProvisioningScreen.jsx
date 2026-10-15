import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api.js";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import EmptyState from "@/lib/empty/EmptyState.jsx";

const stepLabels = {
  organisation_and_admin: {
    label: "Practice created and owner invited",
    explanation: "Its own space in the database, nobody else can see it",
  },
  stripe_customer: {
    label: "Stripe",
    explanation_waiting: (firstName) => `Waiting on ${firstName}. Nothing can be charged until they do it.`,
    explanation: "Connect to accept payments",
  },
  form_workspace: {
    label: "Forms workspace",
    explanation: "Where their intake forms live",
  },
  resend_domain: {
    label: "Email sending",
    explanation_waiting: "Runs as soon as they give us a web address",
    explanation: "Custom domain for practice emails",
  },
};

const numberToWords = (n) => {
  const ones = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  return ones[n] ?? String(n);
};

const formatDuration = (startedAt, completedAt) => {
  if (!startedAt || !completedAt) return "—";
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  const seconds = (end - start) / 1000;
  return `${seconds.toFixed(1)}s`;
};

const outstanding = (run) => (run?.steps ?? []).some((s) => s.state !== "succeeded" && s.state !== "skipped");

const countSteps = (run) => {
  const all = run?.steps ?? [];
  const succeeded = all.filter(s => s.state === "succeeded" || s.state === "skipped").length;
  return { succeeded, total: all.length };
};

const getChipState = (step) => {
  if (step.state === "awaiting_human") return "act";
  if (step.state === "succeeded" || step.state === "skipped") return "ok";
  if (step.state === "failed") return "bad";
  return "neutral";
};

const getChipLabel = (step) => {
  if (step.state === "awaiting_human") return "Waiting on them";
  if (step.state === "succeeded") return "Done";
  if (step.state === "failed") return "Failed";
  if (step.state === "pending" || step.state === "running") return "Working…";
  return "Skipped";
};

const getStepExplanation = (step, selectedRun) => {
  const meta = stepLabels[step.name];
  if (!meta) return "";
  if (step.state === "awaiting_human") {
    return meta.explanation_waiting
      ? (typeof meta.explanation_waiting === "function"
        ? meta.explanation_waiting(selectedRun?.tenant_name?.split(" ")[0] || "them")
        : meta.explanation_waiting)
      : meta.explanation;
  }
  return meta.explanation;
};

export default function ProvisioningScreen({ rank, onReload }) {
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState(null);
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [selectedSteps, setSelectedSteps] = useState(null);
  const [stepsLoading, setStepsLoading] = useState(false);
  const [stepsError, setStepsError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [problem, setProblem] = useState(null);
  const [report, setReport] = useState(null);

  const maySee = rank === "super_admin_1";

  const load = async () => {
    try {
      const data = await api.provisioning();
      setRuns(data?.runs ?? []);
      setError(null);
      // Select the first outstanding run or the first run
      if ((data?.runs ?? []).length > 0 && !selectedRunId) {
        const id = (data.runs ?? []).find(r => outstanding(r))?.id || (data.runs ?? [])[0]?.id;
        setSelectedRunId(id);
        if (id) {
          await loadSteps(id);
        }
      }
    } catch (err) {
      setError(err);
      setRuns([]);
    }
  };

  const loadSteps = async (runId) => {
    setStepsLoading(true);
    setSelectedSteps(null);
    setStepsError(null);
    try {
      const data = await api.provisioningSteps(runId);
      setSelectedSteps(data?.steps ?? []);
    } catch (err) {
      setStepsError(err);
      setSelectedSteps([]);
    } finally {
      setStepsLoading(false);
    }
  };

  const selectRun = (runId) => {
    setSelectedRunId(runId);
    loadSteps(runId);
  };

  useEffect(() => {
    load();
  }, []);

  const advance = async (run) => {
    setBusy(run.id);
    setProblem(null);
    setReport(null);
    try {
      const res = await api.advanceProvisioningRun({ runId: run.id });
      setReport({ runId: run.id, steps: res?.steps ?? [] });
      await load();
      onReload?.();
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(null);
    }
  };

  const selectedRun = runs?.find(r => r.id === selectedRunId);

  if (error) {
    return (
      <div
        className="rounded-card border border-line bg-surface p-6 text-center"
        role="alert"
        data-testid="provisioning-error"
        data-status={error.status ?? "unknown"}
      >
        {error.status === 403 ? (
          <h1 className="m-0 text-lg">You do not have access to this screen</h1>
        ) : (
          <h1 className="m-0 text-lg">Provisioning runs could not be loaded</h1>
        )}
        <p className="m-0 text-mute">{error.message}</p>
        {error.requestId && (
          <p className="m-0 text-xs text-mute">Reference: {error.requestId}</p>
        )}
      </div>
    );
  }

  if (runs === null) {
    return (
      <p className="text-mute" data-testid="loading">Loading…</p>
    );
  }

  if (runs.length === 0) {
    return (
      <section className="bg-surface" data-testid="provisioning" data-rows={0}>
        <EmptyState
          kind="first-run"
          headline="No practice has been set up yet"
          line="When a new practice is provisioned, its setup run appears here."
          data-testid="list-empty"
        />
      </section>
    );
  }

  if (!selectedRunId || !selectedRun) {
    return (
      <section className="bg-surface" data-testid="provisioning" data-rows={runs.length}>
        <EmptyState
          kind="first-run"
          headline="No run selected"
          line="Select a run to see its details."
        />
      </section>
    );
  }

  const counts = countSteps(selectedRun);

  return (
    <section className="bg-surface" data-testid="provisioning" data-rows={runs.length}>
      <div className="flex items-end gap-4 pb-[18px]">
        <div className="flex-1">
          <h1 className="m-0 font-fraunces text-[24px] font-medium leading-[1] tracking-[-0.01em]">
            Setting up {selectedRun.tenant_name ?? "Practice"}
          </h1>
          <div className="mt-[5px] text-[13.5px] text-mute">
            {numberToWords(counts.succeeded)} of {numberToWords(counts.total)} steps done. It takes about a minute.
          </div>
        </div>
      </div>

      <div className="flex gap-[22px] items-start">
        <div className="flex-1 min-w-0">
          <div className="bg-surface border border-line rounded-[12px] mb-[18px]">
            <div className="flex items-center gap-[10px] p-[14px_17px] border-b border-hair">
              <b className="font-medium text-[14.5px] flex-1">What's happening</b>
            </div>
            <div className="p-[6px_17px_14px]">
              {stepsLoading ? (
                <p className="text-mute" data-testid="loading">Loading steps…</p>
              ) : stepsError ? (
                <div data-testid="provisioning-error">
                  <ErrorPanel error={stepsError} />
                </div>
              ) : selectedSteps && selectedSteps.length > 0 ? (
                selectedSteps.map((step) => (
                  <div
                    key={step.name}
                    className="flex items-center gap-3 py-[11px] border-b border-hair last:border-b-0 text-[14px]"
                    data-testid="provisioning-step"
                    data-state={step.state}
                  >
                    <span className="w-[74px] flex-shrink-0 text-[13px] text-mute font-variant-tabular-nums">
                      {formatDuration(step.started_at, step.completed_at)}
                    </span>
                    <span className="flex-1">
                      <div>{stepLabels[step.name]?.label ?? step.name}</div>
                      <div className="block text-[12.5px] text-mute mt-[2px]">
                        {getStepExplanation(step, selectedRun)}
                      </div>
                    </span>
                    <StatusBadge
                      tone={getChipState(step)}
                      label={getChipLabel(step)}
                    />
                    {step.state === "failed" && step.retryable ? (
                      <button
                        type="button"
                        className="inline-flex items-center justify-center gap-2 h-[32px] px-[13px] rounded-[7px] font-medium text-[13px] border border-line bg-surface text-ink-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        data-testid="provisioning-try-again"
                        disabled={busy === selectedRun.id}
                        onClick={() => advance(selectedRun)}
                      >
                        Try again
                      </button>
                    ) : null}
                  </div>
                ))
              ) : null}
            </div>
          </div>
        </div>

        <div className="w-[320px] flex-shrink-0">
          <div className="bg-surface border border-line rounded-[12px] mb-[18px]">
            <div className="flex items-center gap-[10px] p-[14px_17px] border-b border-hair">
              <b className="font-medium text-[14.5px] flex-1">What they get before doing anything</b>
            </div>
            <div className="p-[6px_17px_14px]">
              <div className="flex items-center gap-3 py-[11px] border-b border-hair text-[14px]">
                <span className="flex-1">
                  <div>A working practice</div>
                  <div className="block text-[12.5px] text-mute mt-[2px]">
                    They can add services and book people in the first minute
                  </div>
                </span>
              </div>
              <div className="flex items-center gap-3 py-[11px] border-b border-hair text-[14px]">
                <span className="flex-1">
                  <div>Sensible defaults</div>
                  <div className="block text-[12.5px] text-mute mt-[2px]">
                    24 hours notice, 14-day invoice terms, reminders on. All changeable.
                  </div>
                </span>
              </div>
              <div className="flex items-center gap-3 py-[11px] text-[14px]">
                <span className="flex-1">
                  <div>Two agreements</div>
                  <div className="block text-[12.5px] text-mute mt-[2px]">
                    Written in plain words, theirs to edit
                  </div>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {report ? (
        <section
          className="rounded-card border border-line bg-surface p-[14px_17px]"
          data-testid="provisioning-report"
        >
          <h2 className="font-medium text-[15px] mb-[14px] mt-0">What happened</h2>
          <ul className="list-none p-0 m-0">
            {report.steps.map((s, i) => (
              <li
                key={s.name ?? i}
                className="flex gap-3 py-[10px] border-b border-hair last:border-b-0"
                data-attempted={s.attempted ? "true" : "false"}
              >
                <span className="w-[190px] flex-shrink-0 font-medium text-[14px] text-ink-2">
                  {s.name}
                </span>
                <span className="flex-1 text-[14px] text-ink-2">
                  {s.attempted ? (s.outcome ?? "attempted") : (s.reason ?? "not attempted")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {problem ? (
        <p
          className="text-[var(--color-bad)] bg-[var(--color-bad-soft)] border border-line rounded-[12px] p-[12px_16px] mt-3"
          data-testid="provisioning-problem"
          role="alert"
        >
          {problem}
        </p>
      ) : null}
    </section>
  );
}
