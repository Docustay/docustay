// ProgramRecord — Programs follow-up brief (30 Sep 2026, Part 3): "clickable Program/Category
// detail pages." A read-only record view: the program's name plus every service/package/plan in
// it, each a real link back to its own editor (the same catalogue editors Part 4 extended).
import { useState, useEffect, useCallback } from "react";
import { request, ApiError } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import { LedgerPage } from "@/lib/components/kit/archetypes/index.js";

export default function ProgramRecord({ path = null, params = null, app = null, onNavigate = null }) {
  const id = params?.id ?? null;
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState(null);
  const [program, setProgram] = useState(null);

  function go(href) {
    if (onNavigate) onNavigate(href);
    else window.location.assign(href);
  }

  const load = useCallback(async () => {
    if (!id) return;
    setPhase("loading");
    setError(null);
    try {
      const res = await request(`/api/items/programs/${encodeURIComponent(id)}`);
      setProgram(res?.data ?? null);
      setPhase("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setPhase("denied");
        setError(err);
      } else if (err instanceof ApiError && err.status === 404) {
        setPhase("error");
        setError({ message: "No such program.", requestId: err.requestId });
      } else {
        setPhase("error");
        setError(err instanceof ApiError
          ? { message: err.message, requestId: err.requestId }
          : { message: String(err?.message ?? err) });
      }
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  function Section({ title, items, hrefPrefix }) {
    if (!items || items.length === 0) {
      return (
        <div className="py-3 text-sm text-mute" data-testid={`program-record-${hrefPrefix}-empty`}>
          No {title.toLowerCase()} in this program.
        </div>
      );
    }
    return (
      <div className="overflow-auto rounded-card border border-line bg-surface mb-4" data-testid={`program-record-${hrefPrefix}-table`}>
        <table className="w-full border-collapse">
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td className="h-11.5 border-b border-hair px-4 text-sm text-ink">
                  <a
                    href={`/items/${hrefPrefix}/${it.id}`}
                    onClick={(e) => { e.preventDefault(); go(`/items/${hrefPrefix}/${it.id}`); }}
                    className="text-brand hover:text-brand no-underline"
                  >
                    {it.name}
                  </a>
                </td>
                <td className="h-11.5 border-b border-hair px-4 text-sm text-mute text-right">
                  {it.archived ? "Archived" : it.active === false ? "Inactive" : "Active"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <LedgerPage
      title={program?.name ?? "Program"}
      summary="Every service, package and plan in this program."
      testId="program-record"
    >
      <ScreenState
        phase={phase}
        error={phase === "error" ? error : null}
        reason={phase === "denied" ? (error?.message ?? null) : null}
        onNavigate={onNavigate}
      >
        {program && (
          <div>
            <h3 className="text-sm font-medium text-mute mt-2 mb-1">Services</h3>
            <Section title="Services" items={program.services} hrefPrefix="services" />
            <h3 className="text-sm font-medium text-mute mt-2 mb-1">Packages</h3>
            <Section title="Packages" items={program.packages} hrefPrefix="packages" />
            <h3 className="text-sm font-medium text-mute mt-2 mb-1">Plans</h3>
            <Section title="Plans" items={program.plans} hrefPrefix="plans" />
          </div>
        )}
      </ScreenState>
    </LedgerPage>
  );
}
