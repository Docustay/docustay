import { useEffect, useState } from "react";
import { Button } from "@/lib/components/ui/button.jsx";

export default function SetupPanel({
  groups = [],
  summary = null,
  tenantId = null,
  forceOpen = false,
  onNavigate = null,
}) {
  const storageKey = `ks-setup-dismissed:${tenantId ?? "unknown"}`;
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (forceOpen) {
      setDismissed(false);
      return;
    }

    try {
      const stored = sessionStorage.getItem(storageKey) === "1";
      setDismissed(stored);
    } catch {
      // private window etc — not fatal
      setDismissed(false);
    }
  }, [forceOpen, storageKey]);

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(storageKey, "1");
    } catch {
      // private window etc — not fatal
    }
  };

  // ★ Setup complete once `summary.allDone` — same server-computed fact
  const hidden = dismissed || !summary || summary.total <= 0 || !!summary.allDone;
  const visibleGroups = (groups ?? []).filter((g) => g.rows?.length);

  if (hidden) {
    return null;
  }

  return (
    <section
      data-testid="home-setup-panel"
      className="flex flex-col gap-6 bg-surface rounded-2xl px-6 py-6 mb-10 shadow-raised"
    >
      {/* HEADER: Title + Dismiss button */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium text-ink">Complete your setup</h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="home-setup-dismiss"
          onClick={dismiss}
        >
          Dismiss
        </Button>
      </div>

      {/* VISIBLE GROUPS */}
      {visibleGroups.map((group) => (
        <section key={group.key} data-group={group.key} className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-ink">{group.title}</h3>
          <ul className="list-none m-0 p-0 flex flex-col gap-0">
            {group.rows.map((row, i) => (
              <li
                key={row.title + i}
                data-status={row.status}
                className="flex items-start gap-3 px-0 py-2.75 border-b border-hair text-sm text-ink last:border-b-0"
              >
                <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <span className="font-medium text-ink">{row.title}</span>
                  {row.whatIsBlocked && (
                    <span className="text-xs text-ink-muted">{row.whatIsBlocked}</span>
                  )}
                  {row.whatToDo && (
                    <span className="text-xs text-ink-muted">{row.whatToDo}</span>
                  )}
                </span>
                {row.fixUrl && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => onNavigate?.(row.fixUrl)}
                  >
                    Go
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
