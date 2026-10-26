// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DeveloperActionsApikeySheet — the form drawer for creating API keys.
// Ported from webui/src/lib/screens/DeveloperActions.svelte:102-175 (the <ActionSurface> element).
// Mounted when `open` is true; closed on cancel or successful save.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import ActionSurface from "@/lib/forms/ActionSurface.jsx";
import { Input } from "@/lib/components/ui/input.jsx";

export default function DeveloperActionsApikeySheet({
  open = false,
  onOpenChange = null,
  name = "",
  onNameChange = null,
  scopes = new Set(),
  grantableScopes = [],
  onScopeToggle = null,
  environment = "test",
  onEnvironmentChange = null,
  tokenClass = "secret",
  onTokenClassChange = null,
  created = null,
  copied = false,
  busy = false,
  problem = null,
  toggle = null,
  ready = false,
  mint = null,
  copy = null,
  finish = null,
}) {
  // ★ These are replaced with Tailwind utilities:
  // ★ ks-secret-warn: alert styling for the "shown once" warning (now: border + bg + text from tokens)
  // ★ ks-secret: monospace, read-only text for the key display (now: font-mono, border, bg)
  // ★ ks-scope: checkbox container with tight spacing (now: flex + gap + items-center)
  const dismiss = () => onOpenChange?.(false);
  const handleCancel = () => dismiss();
  const handleSubmit = () => {
    if (created) {
      finish?.();
    } else {
      mint?.();
    }
  };

  return (
    <>
      {open && (
        <ActionSurface
          kind="drawer"
          title={created ? "Key created" : "New API key"}
          testId="apikey"
          busy={busy}
          error={problem}
          submitLabel={created ? "Done" : "Create the key"}
          busyLabel="Creating…"
          submitDisabled={created ? false : !ready}
          dismissable={!created}
          footerNote={created || scopes.size ? null : "Choose at least one scope — a key with none can do nothing."}
          cancelLabel="Cancel"
          onCancel={handleCancel}
          onSubmit={handleSubmit}
        >
          {created ? (
            <>
              {/* ★★★ SHOWN EXACTLY ONCE, AND SAID SO BEFORE IT CAN BE DISMISSED. */}
              <p
                className="rounded-sm border border-warning-border bg-warning-25 px-3 py-2.5 text-meta text-warning-800"
                data-testid="apikey-warning"
                role="alert"
              >
                This is the only time this key is shown. Copy it now.
              </p>
              <div className="flex flex-col gap-3 py-4">
                <div className="flex flex-col gap-1.5">
                  <span className="text-meta font-medium text-ink">Key</span>
                  <code className="inline-block rounded-sm border border-line bg-paper px-3 py-2.5 font-mono text-sm break-all" data-testid="apikey-secret">
                    {created.key ?? created.secret}
                  </code>
                  <button
                    type="button"
                    className="mt-2 inline-flex items-center justify-center h-8 px-3 text-meta font-medium rounded-sm border border-line bg-surface hover:bg-paper text-ink-2"
                    data-testid="apikey-copy"
                    onClick={copy}
                  >
                    {copied ? "Copied" : "Copy key"}
                  </button>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-meta font-medium text-ink">Fingerprint</span>
                  <p className="text-control text-ink" data-testid="apikey-fingerprint">
                    {created.fingerprint ?? created.last_four ?? "—"}
                  </p>
                  <span className="text-meta text-mute">
                    This is what you will see in the list from now on. It lets you confirm which key is which
                    without anyone sending it.
                  </span>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-4 py-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="apikey-name" className="text-meta font-medium text-ink">
                  What it is for
                </label>
                <Input
                  id="apikey-name"
                  type="text"
                  data-testid="apikey-name"
                  value={name}
                  onChange={(e) => onNameChange?.(e.target.value)}
                  maxLength={120}
                  placeholder="Give it a name"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-meta font-medium text-ink">What it may do</span>
                <p className="text-meta text-mute" data-testid="apikey-scope-count">
                  {scopes.size} of {grantableScopes.length} chosen
                </p>
                <div className="flex flex-col gap-2">
                  {grantableScopes.map((s) => (
                    <label
                      key={s}
                      className="flex items-center gap-2 py-1 px-0 text-meta"
                    >
                      <input
                        type="checkbox"
                        data-testid={`apikey-scope-${s}`}
                        checked={scopes.has(s)}
                        onChange={() => onScopeToggle?.(s)}
                        className="size-4 rounded border-input"
                      />
                      <code className="text-sm">{s}</code>
                    </label>
                  ))}
                </div>
                {/* ★★ THE SERVER DECIDES WHETHER THE CALLER MAY GRANT THESE, AND SAYS SO IF NOT. */}
                <span className="text-meta text-mute">
                  You can only grant what you hold yourself — anything beyond that is refused, with a reason.
                </span>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="apikey-env" className="text-meta font-medium text-ink">
                  Environment
                </label>
                <select
                  id="apikey-env"
                  data-testid="apikey-env"
                  value={environment}
                  onChange={(e) => onEnvironmentChange?.(e.target.value)}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-base"
                >
                  <option value="test">Test</option>
                  <option value="live">Live</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="apikey-class" className="text-meta font-medium text-ink">
                  Kind
                </label>
                <select
                  id="apikey-class"
                  data-testid="apikey-class"
                  value={tokenClass}
                  onChange={(e) => onTokenClassChange?.(e.target.value)}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-base"
                >
                  <option value="secret">Secret — server to server</option>
                  <option value="publishable">Publishable — safe in a browser</option>
                </select>
              </div>
            </div>
          )}
        </ActionSurface>
      )}
    </>
  );
}
