// PageHeader — list title, "N records" / "N of M records", Copy link, actions. Ported from
// webui/src/lib/lists/PageHeader.svelte: same props, testids and copy.
import { useEffect, useRef, useState } from "react";
import PageTitle from "@/lib/components/kit/PageTitle.jsx";

export default function PageHeader({ title, count = null, total = null, noun = "record", actions = null, children = null }) {
  const filtered = total !== null && count !== null && total !== count;
  const word = (count === 1 && !filtered) || total === 1 ? noun : `${noun}s`;
  const [copyConfirmed, setCopyConfirmed] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copyLinkToClipboard() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyConfirmed(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopyConfirmed(false), 2000);
    } catch (err) {
      console.error("Failed to copy link:", err);
    }
  }
  const showSummary = count !== null && (filtered || count > 0);
  return (
    <header className="mb-4.5 flex items-end gap-4" data-testid="page-header">
      <div className="min-w-0 flex-1">
        <PageTitle testId="page-title">{title}</PageTitle>
        {showSummary && <p className="mt-1.25 text-control text-mute" data-testid="list-count">{filtered ? `${count} of ${total} ${word}` : `${count} ${word}`}</p>}
      </div>
      {children}
      <div className="flex items-center gap-2">
        <button type="button" className="inline-flex h-(--size-filter) items-center gap-1.5 rounded-control border border-line bg-surface px-3 text-control text-ink-2"
                onClick={copyLinkToClipboard} title="Copy link to this view" data-testid="copy-link-btn" aria-label="Copy link to this view"
                data-confirmed={copyConfirmed ? "true" : undefined}>
          {copyConfirmed ? <><span aria-hidden="true">✓</span> Copied</> : <><span aria-hidden="true">🔗</span> Copy link</>}
        </button>
        {actions && <div className="flex items-center gap-2" data-testid="list-actions">{actions}</div>}
      </div>
    </header>
  );
}
