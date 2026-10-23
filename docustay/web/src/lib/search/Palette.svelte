<script>
  // ⌘K — SEARCH EVERYTHING (Run 9 board "Search everything"). One box over documents, templates and people, with "Ask Scribe" as the last row. Opens with ⌘K / Ctrl+K
  // anywhere in the app, or the sidebar's Search button. ARIA combobox + listbox: ↑↓ move, ↵ opens, ⌘↵ / Ctrl+↵ asks Scribe, Esc closes (Ark Dialog keeps focus inside and gives it back).
  // The server answers in groups (src/documents/search.mjs, RLS); words under each title are worded here, in the reader's language.
  import { Dialog } from "@ark-ui/svelte/dialog";
  import { Portal } from "@ark-ui/svelte/portal";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { api } from "$lib/api.js";
  import Icon from "$lib/ui/Icon.svelte";
  import Kbd from "$lib/ui/Kbd.svelte";
  import { chat } from "$lib/chat/chat.svelte.js";
  import { relativeTime } from "$lib/ui/relativeTime.js";
  import { t, i18n } from "$lib/i18n/index.svelte.js";
  import { palette } from "./palette.svelte.js";

  let q = $state(""), res = $state(null), busy = $state(false), active = $state(0), problem = $state(null);
  let timer, seq = 0;
  const day = (iso) => (iso ? new Date(iso).toLocaleDateString(i18n.lang, { day: "numeric", month: "short" }) : "");
  const ago = (iso) => relativeTime(iso, { locale: i18n.lang });
  function docLine(d) {
    if (d.form) return t("Form response");
    if (d.state === "executed") return t("Signed · {when}", { when: day(d.executedAt) });
    if (d.state === "sent") { const left = Math.max(0, d.signers - d.signed); return [left ? t("Waiting on {n} of {m} signers", { n: left, m: d.signers }) : t("Waiting"), d.sentAt ? t("sent {when}", { when: ago(d.sentAt) }) : ""].filter(Boolean).join(" · "); }
    if (d.state === "draft") return t("Draft · not sent yet");
    if (d.state === "declined") return t("Declined");
    if (d.state === "void") return t("Voided");
    if (d.state === "expired") return t("Expired");
    return "";
  }
  function personLine(p) {
    const l = p.last; if (!l) return p.email;
    if (l.form) return t("filled in “{title}” on {when}", { title: l.title, when: day(l.at) });
    if (l.status === "signed") return t("signed “{title}” on {when}", { title: l.title, when: day(l.at) });
    return t("was sent “{title}” on {when}", { title: l.title, when: day(l.at) });
  }
  const rows = $derived.by(() => {
    const out = [];
    if (res) {
      for (const d of res.groups.documents) out.push({ group: "documents", id: `d-${d.id}`, title: d.title, line: docLine(d), href: d.href });
      for (const tp of res.groups.templates) out.push({ group: "templates", id: `t-${tp.id}`, title: tp.title, tag: t("template"), href: tp.href });
      for (const p of res.groups.people) out.push({ group: "people", id: `p-${p.id}`, title: p.name, line: personLine(p), href: p.href, person: true });
    }
    if (q.trim().length >= 2 && chat.status?.enabled !== false) out.push({ group: "actions", id: "ask", title: t("Ask Scribe: “{q}”", { q: q.trim() }), ask: true });
    return out;
  });
  const GROUP = () => ({ documents: t("Documents"), templates: t("Templates"), people: t("Contacts"), actions: t("Actions") });
  async function search() {
    const term = q.trim(); const my = ++seq;
    if (term.length < 2) { res = null; busy = false; problem = null; return; }
    busy = true; const r = await api(`/api/documents/search?q=${encodeURIComponent(term)}`); if (my !== seq) return;
    busy = false; if (r.ok) { res = r.json?.data ?? r.json; problem = null; active = 0; } else { problem = r.error ?? t("Search did not answer. Try again."); }
  }
  const typed = () => { clearTimeout(timer); timer = setTimeout(search, 140); };
  async function choose(row, { ask = false } = {}) {
    if (!row) return;
    palette.open = false;
    if (ask || row.ask) { await chat.show(); await chat.send(q.trim(), `${page.url.pathname}${page.url.search}`.slice(0, 200)); return; }
    await goto(row.href);
  }
  function key(e) {
    if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(rows.length - 1, active + 1); scrollActive(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(0, active - 1); scrollActive(); }
    else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (q.trim().length >= 2) choose(rows.find((r) => r.ask) ?? { ask: true }, { ask: true }); }
    else if (e.key === "Enter") { e.preventDefault(); choose(rows[active]); }
  }
  const scrollActive = () => queueMicrotask(() => document.getElementById(`pal-${rows[active]?.id}`)?.scrollIntoView({ block: "nearest" }));
  $effect(() => { if (!palette.open) { q = ""; res = null; active = 0; problem = null; } });
  // ⌘K / Ctrl+K anywhere (not while typing in another field unless it is this one); "/" also opens it from outside a field
  $effect(() => {
    const onKey = (e) => { const k = e.key?.toLowerCase(); if ((e.metaKey || e.ctrlKey) && k === "k") { e.preventDefault(); palette.open = !palette.open; return; }
      if (k === "/" && !palette.open && !/^(input|textarea|select)$/i.test(document.activeElement?.tagName ?? "") && !document.activeElement?.isContentEditable) { e.preventDefault(); palette.open = true; } };
    addEventListener("keydown", onKey); return () => removeEventListener("keydown", onKey);
  });
</script>
<Dialog.Root open={palette.open} onOpenChange={(d) => (palette.open = d.open)} lazyMount unmountOnExit initialFocusEl={() => document.getElementById("pal-input")}>
  <Portal>
    <Dialog.Backdrop class="pal-back" />
    <Dialog.Positioner class="pal-pos">
      <Dialog.Content class="pal" data-testid="palette" aria-label={t("Search everything")}>
        <div class="pal-head"><Icon name="search" size={17} class="text-mute" />
          <input id="pal-input" class="pal-input" bind:value={q} oninput={typed} onkeydown={key} placeholder={t("Search documents, templates and contacts")} autocomplete="off" spellcheck="false"
            role="combobox" aria-expanded={rows.length > 0} aria-controls="pal-list" aria-activedescendant={rows[active] ? `pal-${rows[active].id}` : undefined} aria-autocomplete="list" data-testid="palette-input" />
          <Dialog.CloseTrigger class="pal-esc" aria-label={t("Close")}>esc</Dialog.CloseTrigger></div>
        <div class="pal-body">
          {#if problem}<p class="pal-note" role="alert">{problem}</p>
          {:else if q.trim().length < 2}<p class="pal-note" data-testid="palette-hint">{t("Type at least two letters. Press / or ⌘K to open this from anywhere.")}</p>
          {:else if res && rows.length === (rows.some((r) => r.ask) ? 1 : 0)}<p class="pal-note" data-testid="palette-empty">{t("Nothing matches “{q}”.", { q: q.trim() })}</p>{/if}
          <ul id="pal-list" role="listbox" aria-label={t("Results")} aria-busy={busy}>
            {#each rows as row, i (row.id)}
              {#if i === 0 || rows[i - 1].group !== row.group}<li class="pal-group" role="presentation">{GROUP()[row.group]}</li>{/if}
              <li id={`pal-${row.id}`} role="option" aria-selected={i === active} class="pal-row" class:on={i === active} onmousemove={() => (active = i)} onclick={() => choose(row)} data-testid={`palette-${row.group}`}>
                <span class="pal-icon" class:av={row.person} class:ask={row.ask} aria-hidden="true">{#if row.person}{row.title.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}{:else if row.ask}<Icon name="sparkle" size={14} />{/if}</span>
                <span class="pal-text"><span class="pal-title">{row.title}{#if row.tag}<span class="pal-tag"> · {row.tag}</span>{/if}</span>{#if row.line}<span class="pal-line">{row.line}</span>{/if}</span>
                {#if i === active}<span class="pal-go" aria-hidden="true">↵ {row.ask ? t("ask") : t("open")}</span>{/if}
              </li>
            {/each}
          </ul>
        </div>
        <div class="pal-foot" aria-hidden="true"><span>↑↓ {t("move")}</span><span>↵ {t("open")}</span><span><Kbd mod>↵</Kbd> {t("ask Scribe")}</span></div>
      </Dialog.Content>
    </Dialog.Positioner>
  </Portal>
</Dialog.Root>
<style>
  :global(.pal-back) { position: fixed; inset: 0; z-index: 60; background: rgb(20 16 40 / .18); backdrop-filter: blur(3px); }
  :global(.pal-pos) { position: fixed; inset: 0; z-index: 61; display: flex; justify-content: center; align-items: flex-start; padding: 12vh 16px 16px; }
  :global(.pal) { width: min(680px, 100%); max-height: 72vh; display: flex; flex-direction: column; background: var(--card); border-radius: var(--rad-l); box-shadow: 0 30px 80px rgb(24 20 60 / .22), 0 2px 6px rgb(24 20 60 / .06); overflow: hidden; transform-origin: 50% 0; animation: pal-in 200ms cubic-bezier(.2,.8,.2,1); }
  @keyframes pal-in { from { opacity: 0; transform: perspective(900px) rotateX(-8deg) translateY(-6px) scale(.98); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { :global(.pal) { animation: none; } }
  .pal-head { display: flex; align-items: center; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--hair); }
  .pal-input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font-size: 17px; color: var(--ink); }
  :global(.pal-esc) { font: 500 11px/1 var(--font-mono); color: var(--mute); border: 1px solid var(--line); border-radius: 6px; padding: 5px 7px; background: var(--card); }
  .pal-body { overflow-y: auto; padding: 8px 10px 10px; }
  .pal-note { margin: 10px 12px; font-size: var(--t-meta); color: var(--mute); }
  ul { list-style: none; margin: 0; padding: 0; }
  .pal-group { padding: 14px 12px 6px; font: 500 11px/1 var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--mute); }
  .pal-row { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: var(--rad-s); cursor: pointer; }
  .pal-row.on { background: var(--lilac-soft); }
  :global([data-theme="dark"]) .pal-row.on { background: var(--brand-soft); }
  .pal-icon { flex: none; width: 28px; height: 28px; border-radius: 6px; background: var(--card); box-shadow: inset 0 0 0 1px var(--line); display: grid; place-items: center; font-size: 11px; font-weight: 600; color: var(--violet); }
  .pal-icon.av { border-radius: 50%; background: #d9d6fb; box-shadow: none; color: #3b2a87; }
  .pal-icon.ask { background: var(--violet); color: #fff; box-shadow: none; }
  .pal-text { min-width: 0; flex: 1; display: grid; gap: 2px; }
  .pal-title { font-size: var(--t-body); font-weight: 500; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pal-tag { font-weight: 400; font-size: var(--t-meta); color: var(--mute); }
  .pal-line { font-size: var(--t-meta); color: var(--mute); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pal-go { flex: none; font-size: 12px; color: var(--violet); }
  .pal-foot { display: flex; gap: 18px; padding: 10px 20px; border-top: 1px solid var(--hair); font-size: 12px; color: var(--mute); }
  @media (max-width: 640px) { :global(.pal-pos) { padding-top: 8px; } .pal-foot { display: none; } }
</style>
