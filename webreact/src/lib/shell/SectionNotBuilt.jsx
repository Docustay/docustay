// A nav row with nothing behind it says so, in words, with the path (R3.012, SectionNotBuilt.svelte).
// ★ The server's reason wins; "cut" says not planned; the path is shown so "which page is broken" answers itself.
import { Wrench } from "lucide-react";
import EmptyState from "@/lib/empty/EmptyState.jsx";
import PageTitle from "@/lib/components/kit/PageTitle.jsx";

export default function SectionNotBuilt({ path, label = null, state = null }) {
  const kind = state?.buildState ?? state?.state ?? "not_built";
  const cut = kind === "cut" || state?.cut === true;
  const headline = cut ? "This is not planned." : kind === "no_read_path" ? "This screen is on its way." : "This section is not built yet.";
  const line = state?.reason ? state.reason : !cut && state?.phase ? "This is planned and not built yet." : headline;
  return (
    <section className="flex flex-col gap-4" data-testid="section-not-built" data-path={path} data-build-state={kind}
      data-cut={cut ? "true" : undefined} data-phase={!cut && state?.phase ? state.phase : undefined}>
      {label ? <PageTitle>{label}</PageTitle> : null}
      <EmptyState kind="not-built" icon={Wrench} headline={headline} line={line} testId="section-not-built-state" />
      <code className="text-caption text-mute">{path}</code>
    </section>
  );
}
