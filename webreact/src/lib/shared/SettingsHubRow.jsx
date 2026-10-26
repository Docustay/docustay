// SettingsHubRow — a settings destination: label, where it turns up, chevron. Ported from
// webui/src/lib/shared/SettingsHubRow.svelte.
export default function SettingsHubRow({ label, where, href, onNavigate = null, testId = "settings-hub-row" }) {
  return (
    <a className="flex items-center gap-3 border-b border-hair px-4 py-3 last:border-b-0 hover:bg-paper" href={href} data-testid={testId}
       onClick={(e) => { if (onNavigate) { e.preventDefault(); onNavigate(href, e); } }}>
      <span className="flex min-w-0 flex-1 flex-col"><b className="text-ui font-medium text-ink">{label}</b><span className="text-meta text-mute">{where}</span></span>
      <span className="text-chevron" aria-hidden="true">›</span>
    </a>
  );
}
