// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R4.021.T1 — NetworkReleases › NetworkReleasesNetworkReleasesTable — the table, inside LedgerPage.
// Ported from webui/src/lib/screens/network/NetworkReleases.svelte:85-116.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import LedgerPage from "@/lib/lists/LedgerPage.jsx";
import SettingsHubRow from "@/lib/shared/SettingsHubRow.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";

export default function NetworkReleasesNetworkReleasesTable({
  onNavigate = null,
  go = null,
  phase = "loading",
  error = null,
  rows = [],
}) {
  return (
    <LedgerPage title="Releases" testId="network-releases">
      <SettingsHubRow
        label="Releases are documents"
        where="Manage the template in Documents"
        href="/documents"
        onNavigate={go}
        testId="releases-hub-row"
      />

      <ScreenState
        phase={phase}
        error={phase === "error" ? error : null}
        reason={phase === "denied" ? error?.message ?? null : null}
        empty={{
          kind: "first-run",
          headline: "No releases yet",
          line: "A signed release is what lets you share more than a name and a reason.",
          action: { label: "Add a release", href: "/documents/contracts/all?new=1" },
        }}
        onNavigate={go}
      >
        <ul className="flex flex-col list-none gap-[10px]" data-testid="releases-list">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-center gap-[10px] min-h-[40px] border-b border-hair last:border-b-0"
              data-testid="release-row"
            >
              <span className="flex-1 min-w-0 text-control text-ink overflow-wrap-break-word">
                {row.title}
              </span>
              <span className="flex-shrink-0 text-meta text-mute">{row.subject ?? ""}</span>
              <span className="flex-shrink-0 text-meta text-mute">{row.state}</span>
            </li>
          ))}
        </ul>
      </ScreenState>
    </LedgerPage>
  );
}
