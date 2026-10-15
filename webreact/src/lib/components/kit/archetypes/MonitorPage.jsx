// MonitorPage — a number over time (COMPONENTS.md §2): ads, rankings, reviews, site speed. A strip of
// figures (kit2 trio — ONE Fraunces moment, Ruling R-51), then the caller's sections. Numbers are a dense
// labelled strip with thin dividers, never tiles in boxes (CLAUDE.md vocabulary 6).
import PageTitle from "@/lib/components/kit/PageTitle.jsx";
import Figure from "@/lib/components/kit/Figure.jsx";
import AppSpinner from "@/lib/components/kit/AppSpinner.jsx";

export function FigureStrip({ items, testId = "figure-strip" }) {
  return (
    <div className="mb-5 flex overflow-hidden rounded-card border border-line bg-surface" data-testid={testId} data-font-moment="figure-strip">
      {items.map((it, i) => (
        <div key={it.key ?? i} className="flex-1 border-r border-hair px-5.5 py-5 last:border-r-0" data-testid={`${testId}-${it.key ?? i}`}>
          <Figure size="md" className="tracking-[-0.02em] leading-none">{it.value}</Figure>
          <div className="mt-1.75 text-meta text-mute">{it.label}</div>
          {it.delta && <div className={`mt-1.25 text-caption ${it.direction === "up" ? "text-ok" : it.direction === "down" ? "text-bad" : "text-mute"}`}>{it.delta}</div>}
        </div>
      ))}
    </div>
  );
}

export default function MonitorPage({ title, summary = null, actions = null, figures = null, loading = false, children, testId = "monitor-page" }) {
  return (
    <div className="flex flex-col" data-testid={testId}>
      <div className="mb-4.5 flex items-end gap-4">
        <div className="min-w-0 flex-1"><PageTitle testId={`${testId}-title`}>{title}</PageTitle>{summary && <p className="mt-1.25 text-control text-mute">{summary}</p>}</div>
        {actions}
      </div>
      {loading ? <AppSpinner /> : <>{figures && <FigureStrip items={figures} testId={`${testId}-figures`} />}{children}</>}
    </div>
  );
}
