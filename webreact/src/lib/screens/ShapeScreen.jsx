import { useState } from "react";
import { api, ApiError } from "@/lib/api.js";
import PageHeader from "@/lib/lists/PageHeader.jsx";
import { RANK_ORDER } from "@/lib/permissions/rank.js";
import { FieldDescription } from "@/lib/components/ui/field.jsx";

export default function ShapeScreen({ view = null, rank = null, onDone = null }) {
  const canWrite =
    RANK_ORDER.indexOf(rank ?? "") >= RANK_ORDER.indexOf("admin") && view?.writable === true;

  const options = view?.options ?? [];

  // ★ Only the in-flight click lives here — the current shape is read from the server's answer.
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  const current = pending ?? view?.shape ?? "both";

  async function choose(key) {
    if (busy || !canWrite || key === current) return;
    const prior = current;
    setBusy(true);
    setProblem(null);
    setPending(key);
    try {
      await api.setShape({ shape: key });
      onDone?.();
    } catch (err) {
      setPending(prior);
      setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title={view?.title ?? "Shape"} />

      {view?.intro && (
        <p className="m-0 text-control text-ink" data-testid="shape-intro">
          {view.intro}
        </p>
      )}

      {problem && (
        <p
          className="m-0 p-[10px] px-3 border border-[var(--color-error-edge)] rounded-sm text-control text-[var(--color-error-edge)]"
          role="alert"
          data-testid="shape-error"
        >
          {problem}
        </p>
      )}

      <ul
        className="list-none m-0 p-0 flex flex-col gap-[var(--gap)]"
        data-testid="shape-list"
      >
        {options.map((o) => (
          <li
            key={o.key}
            className="flex items-stretch"
            data-testid={`shape-option-${o.key}`}
            data-selected={current === o.key}
          >
            <button
              type="button"
              className={`w-full flex items-center justify-between gap-[var(--gap)] p-[var(--pad-cell)] text-left border rounded-control bg-surface hover:bg-paper disabled:opacity-50 disabled:cursor-not-allowed ${
                current === o.key ? "border-[var(--primary-edge)]" : "border-line"
              }`}
              role="radio"
              aria-checked={current === o.key ? "true" : "false"}
              data-testid={`shape-choose-${o.key}`}
              disabled={!canWrite || busy}
              onClick={() => choose(o.key)}
            >
              <span className="flex flex-col gap-0.5 min-w-0">
                <span className="text-control text-ink font-medium">
                  {o.label}
                </span>
                <span className="text-meta text-[var(--ink-muted)]">
                  {o.detail}
                </span>
              </span>
              {current === o.key && <span aria-hidden="true">✓</span>}
            </button>
          </li>
        ))}
      </ul>

      {!canWrite && (
        <FieldDescription data-testid="shape-readonly">
          You can see this but not change it. Changing the practice's shape is an admin action.
        </FieldDescription>
      )}
    </div>
  );
}
