// ConnectPage + ConnectCard — things to switch on (COMPONENTS.md §2): channels, integrations. Each card:
// logo tile, name, one line, an optional note, and a state — connect · continue · on · fix · locked
// (kit2 connect()). The action is the caller's control (a WriteButton), so its permission is asked.
import PageTitle from "@/lib/components/kit/PageTitle.jsx";
import StatusBadge from "@/lib/components/kit/StatusBadge.jsx";
import AppSpinner from "@/lib/components/kit/AppSpinner.jsx";

export function ConnectCard({ name, line, note = null, state = "connect", logo = null, action = null, testId = undefined }) {
  return (
    <div className="flex items-center gap-3.75 border-b border-hair py-4.25 last:border-b-0" data-testid={testId} data-state={state}>
      <span className="flex size-(--size-control) shrink-0 items-center justify-center rounded-control bg-ink-2 text-heading font-semibold text-white" aria-hidden="true">{logo ?? name?.[0]}</span>
      <span className="flex min-w-0 flex-1 flex-col"><b className="text-field font-medium text-ink">{name}</b><span className="mt-0.75 text-meta leading-normal text-mute">{line}</span>{note && <span className="mt-0.75 text-meta text-mute">{note}</span>}</span>
      <span className="flex items-center gap-2.5">
        {state === "on" && <StatusBadge tone="ok" label="Connected" />}
        {state === "fix" && <StatusBadge tone="bad" label="Needs a look" />}
        {action}
      </span>
    </div>
  );
}

export default function ConnectPage({ title, summary = null, groups = [], loading = false, testId = "connect-page" }) {
  return (
    <div className="flex flex-col" data-testid={testId}>
      <div className="mb-4.5"><PageTitle testId={`${testId}-title`}>{title}</PageTitle>{summary && <p className="mt-1.25 text-control text-mute">{summary}</p>}</div>
      {loading ? <AppSpinner /> : groups.map((g) => (
        <section key={g.title} className="mb-6">
          <h2 className="m-0 mb-1 text-heading font-medium text-ink">{g.title}</h2>
          <div className="rounded-card border border-line bg-surface px-5">{g.items}</div>
        </section>
      ))}
    </div>
  );
}
