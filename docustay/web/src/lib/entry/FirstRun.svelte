<script>
  // LAUNCH · THE FIRST-RUN CHECKLIST, at the top of Documents: send a document, make a template, invite a teammate. Each row is ticked from what the workspace really holds (never from a click),
  // so a step done earlier by another route shows done at once. Dismissible; the dismissal is this browser's (a per-viewer convenience). Everything is read through the same lists the screens use.
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  let { documents = null } = $props();   // the Documents page already loaded its rows; the list is reused, not fetched twice
  let hidden = $state(true), tpl = $state(null), team = $state(null), failed = $state(false);
  const KEY = "docustay-firstrun-off";
  onMount(async () => {
    try { hidden = localStorage.getItem(KEY) === "1"; } catch { hidden = false; }
    if (hidden) return;
    const [a, b] = await Promise.all([api("/api/documents/pdf/templates?q=&retired=false&kind=document"), api("/api/list/people/team")]);
    if (!a.ok || !b.ok) { failed = true; return; }
    tpl = (a.json.templates ?? []).length; team = (b.json.rows ?? []).length;
  });
  const sent = $derived(documents === null ? null : documents.some((r) => r.state && r.state !== "draft"));
  const steps = $derived([
    { id: "send", done: sent, label: t("Send a document"), hint: t("Upload a PDF, place the fields, send it."), href: "/create?mode=document&upload=1", go: t("Send") },
    { id: "template", done: tpl === null ? null : tpl > 0, label: t("Make a template"), hint: t("Save a document you send often so it is one click next time."), href: "/templates", go: t("Open templates") },
    { id: "team", done: team === null ? null : team > 1, label: t("Invite a teammate"), hint: t("Anyone you add can send and track documents with you."), href: "/people", go: t("Invite") },
  ]);
  const doneCount = $derived(steps.filter((s) => s.done).length);
  const ready = $derived(!failed && !hidden && steps.every((s) => s.done !== null));
  const dismiss = () => { hidden = true; try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ } };
</script>
{#if ready && doneCount < 3}
<section class="fr" aria-label={t("Getting started")} data-testid="first-run">
  <header><h2>{t("Getting started")}</h2><span class="n" aria-live="polite">{doneCount} / 3</span>
    <div class="bar" aria-hidden="true"><i style:width="{(doneCount / 3) * 100}%"></i></div>
    <button type="button" class="x" onclick={dismiss} aria-label={t("Hide getting started")} data-testid="first-run-dismiss">×</button></header>
  <ol>{#each steps as s (s.id)}
    <li class:done={s.done} data-testid={`first-run-${s.id}`}>
      <span class="tick" aria-hidden="true">{#if s.done}<svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" /></svg>{/if}</span>
      <div><b>{s.label}</b><small>{s.hint}</small></div>
      {#if s.done}<span class="ok">{t("Done")}</span>{:else}<a class="btn" href={s.href}>{s.go}</a>{/if}
    </li>{/each}</ol>
</section>
{/if}
<style>
  .fr { border: 1px solid var(--line, #dcd9f2); border-radius: 14px; background: var(--card, #fff); padding: 14px 18px 8px; margin: 0 0 16px; animation: fr-in 420ms cubic-bezier(.2,.8,.2,1) both; }
  header { display: grid; grid-template-columns: auto auto 1fr auto; align-items: center; gap: 12px; margin-bottom: 6px; }
  h2 { font-size: 14px; font-weight: 650; margin: 0; } .n { font: 600 12px var(--font-mono, monospace); color: var(--mute, #5b5878); }
  .bar { height: 4px; border-radius: 4px; background: var(--line, #e6e4f6); overflow: hidden; } .bar i { display: block; height: 100%; background: #5a3ac1; transition: width 500ms cubic-bezier(.2,.8,.2,1); }
  .x { background: none; border: 0; font-size: 20px; line-height: 1; color: var(--mute, #5b5878); cursor: pointer; padding: 2px 6px; min-width: 24px; min-height: 24px; border-radius: 6px; } .x:hover { background: var(--line, #eeedfa); }
  ol { list-style: none; margin: 0; padding: 0; } li { display: grid; grid-template-columns: 22px 1fr auto; gap: 12px; align-items: center; padding: 10px 0; border-top: 1px solid var(--line, #eeedfa); }
  .tick { width: 20px; height: 20px; border-radius: 50%; border: 1.5px solid var(--line, #c9c5ee); display: grid; place-items: center; } .done .tick { background: #5a3ac1; border-color: #5a3ac1; } .tick svg { width: 12px; height: 12px; fill: none; stroke: #fff; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  b { display: block; font-size: 13.5px; } small { color: var(--mute, #5b5878); font-size: 12.5px; } .done b { color: var(--mute, #5b5878); text-decoration: line-through; }
  .ok { font-size: 12px; color: var(--mute, #5b5878); }
  @keyframes fr-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { .fr { animation: none; } .bar i { transition: none; } }
  @media (max-width: 520px) { header { grid-template-columns: auto auto 1fr auto; } li { grid-template-columns: 22px 1fr; } li .btn, li .ok { grid-column: 2; justify-self: start; } }
</style>
