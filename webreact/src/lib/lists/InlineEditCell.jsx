// InlineEditCell — click, edit, Enter saves, Escape/blur cancels; optimistic, rolls back with the error.
// Ported from webui/src/lib/lists/InlineEditCell.svelte: same props, testids and copy.
import { useEffect, useRef, useState } from "react";

export default function InlineEditCell({ value, displayText, type = "text", options = null, placeholder = null, onSave, testId = null, startEditing = false, onClose = null }) {
  const [editing, setEditing] = useState(startEditing);
  const [draft, setDraft] = useState(value);
  const [displayValue, setDisplayValue] = useState(value);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const field = useRef(null);
  useEffect(() => { if (editing) field.current?.focus(); }, [editing]);
  const begin = () => { setDraft(value); setError(null); setEditing(true); };
  const cancel = () => { setEditing(false); onClose?.(); };
  async function commit() {
    if (draft === value) { setEditing(false); onClose?.(); return; }
    setSaving(true);
    setDisplayValue(draft);
    try { await onSave(draft); setError(null); setEditing(false); onClose?.(); }
    catch (e) { setDisplayValue(value); setError(e?.message ?? "That did not save — try again."); setEditing(false); }
    finally { setSaving(false); }
  }
  const onKeyDown = (e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } else if (e.key === "Escape") { e.preventDefault(); cancel(); } };
  const inputCls = "h-8 w-full rounded-sm border border-brand bg-surface px-2 text-ui text-ink outline-none ring-3 ring-brand-soft";
  if (editing) {
    return type === "select" ? (
      <select ref={field} className={inputCls} value={draft ?? ""} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown} onBlur={cancel} disabled={saving} data-testid={testId}>
        {(options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    ) : (
      <input ref={field} className={inputCls} type={type === "tel" ? "tel" : type === "email" ? "email" : "text"} value={draft ?? ""}
             onChange={(e) => setDraft(e.target.value)} placeholder={placeholder ?? undefined} disabled={saving} onKeyDown={onKeyDown} onBlur={cancel} data-testid={testId} />
    );
  }
  return (
    <>
      <button type="button" className="text-left text-ui text-ink hover:underline data-[optimistic=true]:text-mute" data-optimistic={displayValue !== value ? "true" : undefined} onClick={begin} data-testid={testId}>{displayText}</button>
      {error && <p className="m-0 mt-1 text-meta text-required" role="alert" data-testid={testId ? `${testId}-error` : undefined}>{error}</p>}
    </>
  );
}
