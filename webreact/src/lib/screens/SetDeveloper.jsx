// ═══════════════════════════════════════════════════════════════════════════════════════════
// R8.018 — `/settings/developer`. Developer settings overview with links to feature-specific
// settings pages (API keys, webhooks, embeds, audit log, sandbox).
//
// ★★★ BUILT FROM `specs/mockups/SetDeveloper.frame.html` — header (breadcrumb, h1, subtitle,
//     "Advanced" banner) and each section's own heading + one-line subheading are PORTED
//     VERBATIM, in the frame's own order (API keys, Webhooks, Embeds, Sandbox), plus a 5th
//     section for Audit log (in `SETTINGS_CHILDREN`'s own child order, not shown in the frame).
//
// ★★ ONE DELIBERATE DEVIATION FROM THE FRAME, DOCUMENTED: the frame draws each section's BODY
//     inline (a table of keys, a webhook delivery log, a code snippet, a sandbox button) — but
//     every one of those already has its OWN dedicated, already-built screen with its own
//     writer (`ApiKeysScreen` at `/settings/developer/api-keys`, `AuditLogScreen`, the webhook
//     endpoint form, the sandbox request flow, an embeds screen). Reproducing the frame's inline
//     content here would be a second, divergent copy of state those screens already own — so
//     each section's body here is a single link into its real screen instead. The frame's own
//     row order and each section's own two lines of copy are exactly what carries over.
//
// ★ `view` is the server's own `SETTINGS_CHILDREN` row, asked for, never retyped
//   (`GET /api/settings/developer`, `src/routes/developer.mjs`): `{path, title, description,
//   children: [{key, path, label}]}`. Nothing here invents a title, a path or a label of its
//   own — the same "resolved against the nav, not retyped" discipline `SettingsHome` uses.
// ═══════════════════════════════════════════════════════════════════════════════════════════

import EmptyState from "@/lib/empty/EmptyState.jsx";

export default function SetDeveloper({ view = null, onNavigate = null }) {
  const children = view?.children ?? [];

  // One line per section, taken from the frame verbatim for the 4 sections the frame shows.
  // `dev-audit-log` has no frame counterpart — its line states a plain fact about the screen
  // it links to, matching the register/log framing `SettingsHome` already uses.
  const SUBHEADS = {
    "dev-api-keys": "What each key can do, in plain words.",
    "dev-webhooks": "Tell another app when something happens.",
    "dev-embeds": "Put booking or intake on your website.",
    "dev-audit-log": "A record of every change made in Settings.",
    "dev-sandbox": "A test copy with no real people.",
  };

  function goto(e, href) {
    e.preventDefault();
    onNavigate?.(href);
  }

  return (
    <div
      className="flex flex-col gap-4"
      data-testid="set-developer"
    >
      <div className="flex flex-col gap-1.5">
        <span
          className="text-meta text-mute"
          data-testid="set-developer-crumb"
        >
          <a
            href="/settings"
            onClick={(e) => goto(e, "/settings")}
            className="text-brand no-underline hover:underline"
          >
            Settings
          </a>
          {" › Developer"}
        </span>
        <h1 className="mt-1 m-0 text-page-title font-medium tracking-[-0.01em] text-ink">
          {view?.title ?? "Developer"}
        </h1>
        {view?.description && (
          <p
            className="mt-1.5 m-0 text-control text-mute"
            data-testid="set-developer-subtitle"
          >
            {view.description}
          </p>
        )}
        <div
          className="flex items-center gap-4 rounded-[12px] bg-seg-bg px-4 py-3 text-control text-ink mt-2.5"
          data-testid="set-developer-banner"
        >
          <span className="flex-grow">
            For connecting other software. Most practices never need this.
          </span>
          <span className="inline-flex items-center h-5 px-2.5 rounded-full text-caption font-medium bg-brand-soft text-brand whitespace-nowrap">
            Advanced
          </span>
        </div>
      </div>

      {children.length === 0 ? (
        <EmptyState
          kind="not-built"
          headline="No developer pages yet"
          line="API keys, webhooks and embeds appear here as they're built."
          testId="set-developer-empty"
        />
      ) : (
        <div
          className="flex flex-col"
          data-testid="set-developer-sections"
        >
          {children.map((child) => (
            <section
              key={child.key}
              className="grid grid-cols-1 sm:grid-cols-[240px_minmax(0,1fr)] gap-6 px-0 py-6 border-t border-hair"
              data-testid={`set-developer-section-${child.key}`}
            >
              <div className="flex flex-col gap-1 min-w-0">
                <h2 className="m-0 text-heading font-600 text-ink">
                  {child.label}
                </h2>
                {SUBHEADS[child.key] && (
                  <p className="m-0 text-control text-mute">
                    {SUBHEADS[child.key]}
                  </p>
                )}
              </div>
              <div className="flex flex-col max-w-[480px]">
                <a
                  href={child.path}
                  className="inline-flex items-center gap-4 self-start py-2 text-control text-brand no-underline hover:underline"
                  data-testid={`set-developer-link-${child.key}`}
                  onClick={(e) => goto(e, child.path)}
                >
                  <span>Open {child.label}</span>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-[14px] h-[14px] flex-shrink-0"
                  >
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </a>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
