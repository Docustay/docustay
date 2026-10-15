// ProgramsAndClientTypes — Settings → "Programs & client types" (/settings/programs), Owner/Admin. (QUEUE §4, the maintainer 2 Oct 2026.)
//   1. PROGRAMS — the practice's lines of business. Create, rename, colour, reorder, delete. The list is the shared
//      programs module (`@/lib/programs/programs.js`); every write calls `refreshPrograms()` so every picker, chip and
//      filter in the product updates. Delete goes through the ONE shared dialog (`requestDelete`, object "program").
//   2. CLIENT TYPES — Adult, Adolescent, Parent and Lead are fixed roles (they decide what a person can do); only the
//      WORDS are renameable. Saved through the same write path as /settings/terminology: ONE setting
//      (`terminology.overrides`) holding the whole map, blanks omitted — so this screen starts from every override that
//      already exists and changes only its own eight keys, never wiping a word set on the Terminology screen.
//   3. CATEGORIES — managed on their own screen; linked from here.
import { useState, useEffect, useCallback } from "react";
import { request, api, ApiError } from "@/lib/api.js";
import PageHeader from "@/lib/lists/PageHeader.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { RANK_ORDER } from "@/lib/permissions/rank.js";
import { requestDelete } from "@/lib/record/DeleteDialog.jsx";
import { usePrograms, refreshPrograms, PROGRAM_COLOURS, NO_PROGRAM_COLOUR } from "@/lib/programs/programs.js";
import ProgramChip from "@/lib/programs/ProgramChip.jsx";

// The eight keys, in the order the screen shows them. Singular first, then plural.
const CLIENT_TYPES = Object.freeze([
  { key: "adult", label: "Adult", detail: "An adult client — books, pays and signs for themselves." },
  { key: "adolescent", label: "Adolescent", detail: "A client under 18 — their guardian handles billing and consent." },
  { key: "parent", label: "Parent", detail: "A guardian — sees and pays for the adolescents they are responsible for." },
  { key: "lead", label: "Lead", detail: "Someone who has enquired and is not a client yet." },
]);
const fieldKeys = (k) => [`userType.${k}`, `userType.${k}Plural`];
const ALL_KEYS = CLIENT_TYPES.flatMap((t) => fieldKeys(t.key));

const messageOf = (err) => (err instanceof ApiError
  ? `${err.message}${err.requestId ? ` (ref ${err.requestId})` : ""}`
  : String(err?.message ?? err));

function Swatches({ value, onPick, disabled = false, testId }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Colour" data-testid={testId}>
      {PROGRAM_COLOURS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={`Colour ${c}`}
          disabled={disabled}
          onClick={() => onPick(c)}
          className={`size-5 rounded-full border ${value === c ? "border-ink ring-2 ring-ink/30" : "border-line"} disabled:opacity-50`}
          style={{ background: c }}
          data-testid={`${testId}-${c.slice(1)}`}
        />
      ))}
    </span>
  );
}

function ProgramsSection({ canWrite, onNavigate }) {
  const { programs, loading } = usePrograms();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [newName, setNewName] = useState("");
  const [newColour, setNewColour] = useState(PROGRAM_COLOURS[0]);
  const [renamingId, setRenamingId] = useState(null);
  const [renameText, setRenameText] = useState("");

  useEffect(() => { refreshPrograms(); }, []);

  // One wrapper for every write: busy flag, honest error, then the shared refresh.
  const run = useCallback(async (fn) => {
    setBusy(true); setProblem(null);
    try { await fn(); await refreshPrograms(); return true; }
    catch (err) { setProblem(messageOf(err)); return false; }
    finally { setBusy(false); }
  }, []);

  const create = async (e) => {
    e?.preventDefault?.();
    const name = newName.trim();
    if (!name || busy) { if (!name) setProblem("A program needs a name."); return; }
    const ok = await run(() => request("/api/items/programs", { method: "POST", body: { name, colour: newColour } }));
    if (ok) setNewName("");
  };
  const saveRename = async (p) => {
    const name = renameText.trim();
    if (!name) { setProblem("A program needs a name."); return; }
    const ok = await run(() => request("/api/items/programs/update", { method: "POST", body: { id: p.id, name } }));
    if (ok) setRenamingId(null);
  };
  const setColour = (p, colour) => run(() => request("/api/items/programs/update", { method: "POST", body: { id: p.id, colour } }));
  const move = (index, delta) => {
    const ids = programs.map((p) => p.id);
    const j = index + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    return run(() => request("/api/items/programs/reorder", { method: "POST", body: { ids } }));
  };
  const askDelete = (p) => requestDelete({ object: "program", id: p.id, label: p.name, onDone: () => { refreshPrograms(); } });

  return (
    <section className="mb-8" data-testid="pcts-programs" aria-labelledby="pcts-programs-h">
      <h2 id="pcts-programs-h" className="m-0 mb-1 text-ui font-medium text-ink">Programs</h2>
      <p className="m-0 mb-3 text-ui text-mute">
        A program is a line of business — Life Coaching, Recovery Coaching, anything else you run. Clients, team members, services,
        packages and plans can each belong to one or more.
      </p>
      <p className="m-0 mb-3 rounded-card bg-notice-wash p-3 text-ui text-notice-ink" data-testid="pcts-delete-note" role="note">
        Deleting a program detaches everyone who is in it: the clients and team members stay, they just lose this program.
        Services, packages and plans stop being tagged with it. Nothing else is deleted.
      </p>

      {problem && <p className="mb-3 rounded-card bg-destructive/10 p-3 text-destructive" role="alert" data-testid="pcts-programs-error">{problem}</p>}

      <div className="overflow-auto rounded-card border border-line bg-surface">
        {loading && <p className="m-0 p-4 text-ui text-mute" data-testid="pcts-programs-loading">Loading programs…</p>}
        {!loading && programs.length === 0 && (
          <p className="m-0 p-4 text-ui text-mute" data-testid="pcts-programs-empty">No programs yet. Add the first one below.</p>
        )}
        {programs.map((p, i) => (
          <div key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line-soft px-4 py-2.5 last:border-b-0"
               data-testid="pcts-program-row" data-program-id={p.id}>
            <span className="size-3 shrink-0 rounded-full" style={{ background: p.colour ?? NO_PROGRAM_COLOUR }} aria-hidden="true" />
            <div className="min-w-48 flex-1">
              {renamingId === p.id ? (
                <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); saveRename(p); }}>
                  <Input value={renameText} onChange={(e) => setRenameText(e.target.value)} aria-label={`New name for ${p.name}`}
                         autoFocus maxLength={80} data-testid="pcts-rename-input" />
                  <Button type="submit" size="sm" disabled={busy} data-testid="pcts-rename-save">Save</Button>
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setRenamingId(null)}>Cancel</Button>
                </form>
              ) : (
                <>
                  <ProgramChip program={p} testId="pcts-program-chip" />
                  <p className="m-0 mt-1 text-meta text-mute" data-testid="pcts-program-counts">
                    {Number(p.clients_count) || 0} client{Number(p.clients_count) === 1 ? "" : "s"} ·{" "}
                    {Number(p.team_count) || 0} team · {Number(p.services_count) || 0} service{Number(p.services_count) === 1 ? "" : "s"} ·{" "}
                    {Number(p.packages_count) || 0} package{Number(p.packages_count) === 1 ? "" : "s"} ·{" "}
                    {Number(p.plans_count) || 0} plan{Number(p.plans_count) === 1 ? "" : "s"}
                  </p>
                </>
              )}
            </div>
            {canWrite && renamingId !== p.id && (
              <>
                <Swatches value={p.colour} onPick={(c) => setColour(p, c)} disabled={busy} testId="pcts-colour" />
                <span className="inline-flex items-center gap-1.5">
                  <Button type="button" size="sm" variant="outline" disabled={busy || i === 0} onClick={() => move(i, -1)}
                          aria-label={`Move ${p.name} up`} data-testid="pcts-move-up">Up</Button>
                  <Button type="button" size="sm" variant="outline" disabled={busy || i === programs.length - 1} onClick={() => move(i, 1)}
                          aria-label={`Move ${p.name} down`} data-testid="pcts-move-down">Down</Button>
                  <Button type="button" size="sm" variant="outline" disabled={busy}
                          onClick={() => { setRenamingId(p.id); setRenameText(p.name); setProblem(null); }} data-testid="pcts-rename">Rename</Button>
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => askDelete(p)} data-testid="pcts-delete">Delete</Button>
                </span>
              </>
            )}
            {p.id && onNavigate && renamingId !== p.id && (
              <button type="button" className="text-meta text-mute underline" onClick={() => onNavigate(`/items/programs/${p.id}`)}
                      data-testid="pcts-open">Open</button>
            )}
          </div>
        ))}
      </div>

      {canWrite && (
        <form className="mt-3 flex flex-wrap items-center gap-3" onSubmit={create} data-testid="pcts-create">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New program name" aria-label="New program name"
                 maxLength={80} className="max-w-64" data-testid="pcts-create-name" />
          <Swatches value={newColour} onPick={setNewColour} disabled={busy} testId="pcts-create-colour" />
          <Button type="submit" disabled={busy || !newName.trim()} data-testid="pcts-create-save">{busy ? "Saving…" : "Add program"}</Button>
        </form>
      )}
    </section>
  );
}

function ClientTypesSection({ view, canWrite, onDone }) {
  const terms = view?.terms ?? [];
  const byKey = Object.fromEntries(terms.map((t) => [t.key, t]));
  const [draft, setDraft] = useState({});
  const [seeded, setSeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [saved, setSaved] = useState(false);
  const [warnings, setWarnings] = useState([]);

  // Seeded once per load — re-seeding would wipe what somebody is typing.
  useEffect(() => {
    if (seeded || terms.length === 0) return;
    setDraft(Object.fromEntries(ALL_KEYS.map((k) => [k, byKey[k]?.override ?? ""])));
    setSeeded(true);
  }, [seeded, terms]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = ALL_KEYS.some((k) => (draft[k] ?? "") !== (byKey[k]?.override ?? ""));
  const hasDot = ALL_KEYS.some((k) => String(draft[k] ?? "").includes("."));
  const onChange = (k, v) => { setDraft((d) => ({ ...d, [k]: v })); setSaved(false); setWarnings([]); };

  // The WHOLE map: every override already stored, then this screen's eight keys on top, blanks omitted.
  const buildValue = () => {
    const value = {};
    for (const t of terms) if (!ALL_KEYS.includes(t.key) && typeof t.override === "string" && t.override) value[t.key] = t.override;
    for (const k of ALL_KEYS) { const v = String(draft[k] ?? "").trim(); if (v) value[k] = v; }
    return value;
  };

  const save = async (skipLint = false) => {
    if (busy || !canWrite || hasDot) return;
    setBusy(true); setProblem(null); setSaved(false);
    try {
      const value = buildValue();
      if (!skipLint) {
        const lint = await api.lintTerminology({ overrides: value });
        if (lint?.warnings?.length) { setWarnings(lint.warnings); return; }
      }
      await api.setSetting({ key: view?.settingKey ?? "terminology.overrides", value });
      setWarnings([]); setSaved(true);
      onDone?.();
    } catch (err) {
      setProblem(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-8" data-testid="pcts-client-types" aria-labelledby="pcts-types-h">
      <h2 id="pcts-types-h" className="m-0 mb-1 text-ui font-medium text-ink">Client types</h2>
      <p className="m-0 mb-3 text-ui text-mute" data-testid="pcts-types-explain">
        Adult, Adolescent, Parent and Lead decide what a person can do; you can rename how they appear. Renaming changes the word
        everywhere in Workbench and never changes what the person is allowed to do. Leave a box blank to use the default.
      </p>

      <div className="overflow-auto rounded-card border border-line bg-surface">
        <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-4 border-b border-line px-4 py-2 text-meta text-mute">
          <span>Type</span><span>Singular</span><span>Plural</span>
        </div>
        {CLIENT_TYPES.map((t) => {
          const [one, many] = fieldKeys(t.key);
          return (
            <div key={t.key} className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-4 border-b border-line-soft px-4 py-2.5 last:border-b-0"
                 data-testid="pcts-type-row" data-type={t.key}>
              <div>
                <p className="m-0 text-ui text-ink">{t.label}</p>
                <p className="m-0 text-meta text-mute">{t.detail}</p>
              </div>
              <Input value={draft[one] ?? ""} disabled={!canWrite || busy} maxLength={40} placeholder={byKey[one]?.fallback ?? t.label}
                     onChange={(e) => onChange(one, e.target.value)} aria-label={`${t.label} — singular`} data-testid={`pcts-${one}`} />
              <Input value={draft[many] ?? ""} disabled={!canWrite || busy} maxLength={40} placeholder={byKey[many]?.fallback ?? `${t.label}s`}
                     onChange={(e) => onChange(many, e.target.value)} aria-label={`${t.label} — plural`} data-testid={`pcts-${many}`} />
            </div>
          );
        })}
      </div>

      {hasDot && (
        <p className="mt-3 rounded-card bg-destructive/10 p-3 text-destructive" role="alert" data-testid="pcts-dot">
          A label may not contain a dot — that is an identifier, not a label.
        </p>
      )}
      {problem && <p className="mt-3 rounded-card bg-destructive/10 p-3 text-destructive" role="alert" data-testid="pcts-types-error">{problem}</p>}
      {warnings.length > 0 && (
        <div className="mt-3 rounded-card bg-notice-wash p-3 text-notice-ink" role="alert" data-testid="pcts-lint">
          <p className="m-0 mb-1 font-medium">Longer words break layouts</p>
          {warnings.map((w) => <p key={w.termKey} className="m-0">&ldquo;{w.word}&rdquo; is too wide for {w.where}</p>)}
          <div className="mt-2 flex gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={() => save(true)} data-testid="pcts-save-anyway">Save anyway</Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setWarnings([])}>Change it</Button>
          </div>
        </div>
      )}

      {canWrite ? (
        <div className="mt-3 flex items-center gap-3">
          <Button type="button" disabled={busy || !dirty || hasDot || warnings.length > 0} onClick={() => save(false)} data-testid="pcts-save">
            {busy ? "Saving…" : "Save these words"}
          </Button>
          {saved && !dirty && <span className="text-meta text-mute" role="status" data-testid="pcts-saved">Saved.</span>}
        </div>
      ) : (
        <p className="mt-3 text-meta text-mute" data-testid="pcts-readonly">You can see these words but not change them. Renaming is an admin action.</p>
      )}
    </section>
  );
}

// ── Website enquiries → program (QUEUE §4): each interest on the public enquiry form can put the new lead in a program. ──
function LeadInterestsSection({ canWrite }) {
  const { programs } = usePrograms();
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => { request("/api/items/lead-interests").then((r) => setRows(Array.isArray(r?.data) ? r.data : [])).catch(() => setRows([])); }, []);
  if (!rows || rows.length === 0 || programs.length === 0) return null;
  const setProgram = (id, programId) => setRows(rows.map((r) => (r.id === id ? { ...r, programId: programId || null } : r)));
  const save = async () => {
    setBusy(true); setMsg(null);
    try { await api.setSetting({ key: "growth.lead_interests", value: rows.map((r) => (r.programId ? r : { id: r.id, name: r.name })) }); setMsg("Saved."); }
    catch (e) { setMsg(e?.message ?? "Could not save."); }
    finally { setBusy(false); }
  };
  return (
    <section className="mb-8" data-testid="pcts-lead-interests" aria-labelledby="pcts-lead-h">
      <h2 id="pcts-lead-h" className="m-0 mb-1 text-ui font-medium text-ink">Website enquiries</h2>
      <p className="m-0 mb-3 text-ui text-mute">When someone picks one of these on your enquiry form, they are added to the program you choose.</p>
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <label key={r.id} className="flex items-center gap-3 text-ui text-ink">
            <span className="w-64">{r.name}</span>
            <select disabled={!canWrite} value={r.programId ?? ""} onChange={(e) => setProgram(r.id, e.target.value)} data-testid={`pcts-lead-${r.id}`}
                    className="h-(--size-filter) rounded-control border border-line bg-surface px-2.75 text-control text-ink">
              <option value="">No program</option>
              {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        ))}
      </div>
      {canWrite && <div className="mt-3 flex items-center gap-3"><Button type="button" disabled={busy} onClick={save} data-testid="pcts-lead-save">{busy ? "Saving…" : "Save"}</Button>{msg && <span className="text-meta text-mute" role="status">{msg}</span>}</div>}
    </section>
  );
}

export default function ProgramsAndClientTypes({ view = null, rank = null, onNavigate = null, onDone = null }) {
  const canWrite = RANK_ORDER.indexOf(rank ?? "") >= RANK_ORDER.indexOf("admin");
  const go = (href) => { if (onNavigate) onNavigate(href); else window.location.assign(href); };
  return (
    <>
      <PageHeader title="Programs & client types" />
      <ProgramsSection canWrite={canWrite} onNavigate={onNavigate} />
      <ClientTypesSection view={view} canWrite={canWrite} onDone={onDone} />
      <LeadInterestsSection canWrite={canWrite} />
      <section className="mb-8" data-testid="pcts-categories" aria-labelledby="pcts-cat-h">
        <h2 id="pcts-cat-h" className="m-0 mb-1 text-ui font-medium text-ink">Categories</h2>
        <p className="m-0 mb-3 text-ui text-mute">Categories group your services in the catalogue and on your booking page.</p>
        <Button type="button" variant="outline" onClick={() => go("/items/categories")} data-testid="pcts-categories-link">Manage categories</Button>
      </section>
    </>
  );
}
