// LastChanged — "Changed by the maintainer, 14 September". Ported from webui/src/lib/shared/LastChanged.svelte (en-GB dates).
const LOCALE = "en-GB";
function formatWhen(value) {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const opts = { day: "numeric", month: "long" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString(LOCALE, opts);
}
export default function LastChanged({ at = null, by = null, label = "Changed", testId = "last-changed" }) {
  const when = formatWhen(at);
  if (when == null) return null;
  return <p className="m-0 text-meta text-mute" data-testid={testId}>{by ? `${label} by ${by}, ${when}` : `${label} ${when}`}</p>;
}
