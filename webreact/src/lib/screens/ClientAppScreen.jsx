// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ClientAppScreen — `/settings/client-app`. **WHICH SURFACES THE PEOPLE YOU WORK WITH SEE.**
//
// ★★★ THIS IS A PAYLOAD DECISION AND **NOT A PERMISSION**, AND THE SCREEN HAS TO SAY SO. Turning
//     a surface off removes it from everyone's app and from `/api/app/surfaces`. It does NOT stop
//     anybody reading anything: `document_is_visible()` (migration 0012) is what keeps a parent
//     out of session-note content, and it runs in the database on every request regardless of
//     what is switched here.
//   ★★ An operator who believed this WAS a permission would switch a tab off and think they had
//      protected something. **That is the most dangerous possible misreading of this screen**,
//      which is why the server composes the sentence and it is rendered before the switches
//      rather than as a footnote under them.
//
// ★★★ THE STORED VALUE IS THE **OFF** LIST, AND EACH TOGGLE WRITES THE WHOLE ARRAY. So a toggle
//     recomputes the complete set rather than sending a delta — and the switch is REVERTED on a
//     refusal, because a control that stays where the person put it after the server said no is
//     a screen lying about the state of the practice.
//   ★ `on` comes from the SERVER (`!off.has(key)`), never from a local mirror. The overlay below
//     exists only for the moment between the click and the response.
//
// ★★ WHICH ROLES SEE A SURFACE IS SHOWN ON ITS ROW. "Documents — clients, parents" is what makes
//    switching it off a decision somebody can actually make; a bare list of surface names is not.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { useState, useCallback } from "react";
import { api, ApiError } from "@/lib/api.js";
import PageHeader from "@/lib/lists/PageHeader.jsx";
import LastChanged from "@/lib/shared/LastChanged.jsx";
import { RANK_ORDER } from "@/lib/permissions/rank.js";
import { Button } from "@/lib/components/ui/button.jsx";
import { FieldDescription } from "@/lib/components/ui/field.jsx";

export default function ClientAppScreen({ view = null, rank = null, onDone = null }) {
  const canWrite =
    RANK_ORDER.indexOf(rank ?? "") >= RANK_ORDER.indexOf("admin") && view?.writable === true;

  const surfaces = view?.surfaces ?? [];

  // ★ Only the in-flight click lives here. Everything else is read from the server's answer.
  const [pending, setPending] = useState({});
  const [busy, setBusy] = useState(null);
  const [problem, setProblem] = useState(null);

  const isOn = useCallback(
    (s) => (Object.prototype.hasOwnProperty.call(pending, s.key) ? pending[s.key] : s.on),
    [pending]
  );

  const toggle = useCallback(
    async (s) => {
      if (busy || !canWrite) return;
      const next = !isOn(s);
      const newPending = { ...pending, [s.key]: next };
      setBusy(s.key);
      setProblem(null);
      setPending(newPending);

      try {
        // ★★★ THE WHOLE OFF-LIST, RECOMPUTED. The setting holds one array; sending a delta would
        //     require the server to merge, and a merge is a second place that decides what is on.
        const isOnWithPending = (x) =>
          Object.prototype.hasOwnProperty.call(newPending, x.key) ? newPending[x.key] : x.on;
        const off = surfaces
          .filter((x) => !(x.key === s.key ? next : isOnWithPending(x)))
          .map((x) => x.key);
        await api.setSetting({
          key: view?.settingKey ?? "client_app.surfaces_off",
          value: off,
        });
        onDone?.();
      } catch (err) {
        // ★★ REVERTED. See the header — a switch left in the position the server refused is a lie.
        setPending((prev) => {
          const { [s.key]: _dropped, ...rest } = prev;
          return rest;
        });
        setProblem(err instanceof ApiError ? err.message : String(err?.message ?? err));
      } finally {
        setBusy(null);
      }
    },
    [busy, canWrite, isOn, pending, surfaces, view?.settingKey, onDone]
  );

  return (
    <div>
      <PageHeader title={view?.title ?? "Client app"} count={surfaces.length} noun="surface" />
      {view?.lastChanged && (
        <LastChanged by={view.lastChanged.by} at={view.lastChanged.at} />
      )}

      {view?.intro && (
        <p className="m-0 text-control text-ink" data-testid="client-app-intro">
          {view.intro}
        </p>
      )}

      {view?.notice && (
        <p
          className="m-0 p-[var(--pad-card)] mb-[var(--stack)] border border-[var(--line-strong)] rounded-card bg-[var(--surface-raised)] text-control text-ink"
          role="status"
          data-testid="client-app-notice"
        >
          {view.notice}
        </p>
      )}

      {problem && (
        <p
          className="m-0 p-[10px] px-3 border border-[var(--color-danger-500)] rounded-sm text-control text-[var(--color-danger-500)]"
          role="alert"
          data-testid="client-app-error"
        >
          {problem}
        </p>
      )}

      <ul className="list-none m-0 p-0" data-testid="client-app-surfaces">
        {surfaces.map((s) => (
          <li
            key={s.key}
            className="flex items-center justify-between gap-[var(--gap)] py-[var(--pad-cell)] border-b border-line"
            data-testid={`client-surface-${s.key}`}
            data-on={isOn(s)}
          >
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-control font-medium text-ink">
                {s.label}
              </span>
              {/* ★★ WHO SEES IT. Without this the switch is a name with no consequence attached. */}
              <span className="text-meta text-ink-muted" data-testid={`client-surface-roles-${s.key}`}>
                {(s.roles ?? []).join(", ") || "nobody yet"}
              </span>
            </div>
            <Button
              type="button"
              role="switch"
              aria-checked={isOn(s) ? "true" : "false"}
              aria-label={`${s.label} — ${isOn(s) ? "on" : "off"}`}
              data-testid={`client-surface-toggle-${s.key}`}
              disabled={!canWrite || busy === s.key}
              onClick={() => toggle(s)}
              variant={isOn(s) ? "default" : "outline"}
              size="sm"
            >
              {busy === s.key ? "Saving…" : isOn(s) ? "On" : "Off"}
            </Button>
          </li>
        ))}
      </ul>

      {!canWrite && (
        <FieldDescription data-testid="client-app-readonly">
          You can see these switches but not change them. Turning a surface on or off is an admin
          action.
        </FieldDescription>
      )}
    </div>
  );
}
