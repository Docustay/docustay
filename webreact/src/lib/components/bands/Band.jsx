// Band — the ONE band where rows would be on an empty list (CLAUDE.md vocabulary 1). Ported from
// webui/src/lib/components/bands/Band.svelte: same props, testids; a blocked band shows the server's message.
export default function Band({ kind = "default", title = "", error = null, children = null }) {
  const serverMessage = error == null ? "" : typeof error === "string" ? error : (error.message ?? "");
  return (
    <div className="rounded-card border border-line bg-surface px-6 py-5" data-kind={kind} data-testid="band">
      {title && <div className="text-heading font-medium text-ink">{title}</div>}
      {kind === "blocked" && serverMessage && <p className="m-0 mt-1 text-ui text-mute" data-testid="band-server-message">{serverMessage}</p>}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}
