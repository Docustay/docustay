<script>
  import Cube from "$lib/fx/Cube.svelte";
  import { loadPlan, plan } from "$lib/pro/plan.svelte.js";
  import Pick from "$lib/ui/Pick.svelte";
  import { cardTable } from "$lib/ui/cardTable.js";
  import { ask, askText } from "$lib/ui/confirm.svelte.js";
  import { live } from "$lib/live.js";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import Papa from "papaparse";
  import { api } from "$lib/api.js";
  import { when } from "$lib/docs.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import Rich from "$lib/i18n/Rich.svelte";
  import { rememberStarter, clearStarter } from "$lib/starter.js";
  import { toast } from "$lib/ui/toast.js";
  import autoAnimate from "@formkit/auto-animate";
  import Tabs from "$lib/ui/Tabs.svelte";
  import ProLock from "$lib/pro/ProLock.svelte";
  import TemplateUsage from "$lib/pro/TemplateUsage.svelte";
  import NewTemplateLock from "$lib/pro/NewTemplateLock.svelte";
  import LibraryList from "$lib/templates/LibraryList.svelte";
  // ★ Run 7: ONE Templates page, two kinds — Document templates (sent to people you name) and Form templates (one link many people fill in). The tab decides what New makes.
  // ★ Run 9 Part 4R: each tab lists the workspace's own templates, then the built-in ones (LibraryList): send or publish one as it is, or customize a copy.
  const KIND_TABS = [{ value: "document", label: t("Document templates") }, { value: "form", label: t("Form templates") }];
  let kind = $state(["form", "document"].includes(new URLSearchParams(typeof location === "undefined" ? "" : location.search).get("kind")) ? new URLSearchParams(location.search).get("kind") : "document");
  const REASON = () => ({ retired: t("Retired templates cannot become forms."), not_approved: t("It needs approval before it can become a form."), no_signer: t("Nobody signs it yet, so nobody could fill it in."), too_many_people: t("A form has one person who fills it (and one team member who may counter-sign). This has more people: send it the ordinary way.") });
  let data = $state(null), problem = $state(null), q = $state(""), retired = $state(false), note = $state(null), busy = $state(false);
  // bulk
  let bulkOpen = $state(false), tpls = $state([]), templateId = $state(""), rows = $state([]), fileName = $state(null), check = $state(null), done = $state(null), bulkProblem = $state(null);
  // R8-41: pressing Send a second time sent the whole list again (J2: 3 rows → 6 documents). Each checked list gets ONE key; every batch of the send carries it, so a second press, a
  //   double click or a retry after a lost answer is replayed by the server, never sent twice. A new Check (a new file or template) is a new list and may be sent.
  let sendKey = null;
  const BATCH = 25;
  async function load() { const r = await api(`/api/documents/pdf/templates?q=${encodeURIComponent(q)}&retired=${retired}&kind=${kind}`); if (r.ok) data = r.json; else problem = r.error ?? t("Templates could not be loaded."); }
  function setKind(k) { kind = k; data = null; try { const u = new URL(location.href); u.searchParams.set("kind", k); history.replaceState(history.state, "", u); } catch {} load(); }
  // A built-in picked on the website (or an old ready-made link) arrives here as ?starter=… : its row in the built-in list is shown and marked, to send or customize.
  let highlight = $state(null);
  onMount(async () => {
    const pending = rememberStarter();
    if (pending) { clearStarter(); highlight = pending; }
    await load();
    if (new URLSearchParams(location.search).get("bulk") === "1") await openBulk();
  });
  let timer;
  const reload = () => { clearTimeout(timer); timer = setTimeout(load, 250); };
  async function use(tp) { if (tp.editable) { await goto(`/create/flow?mode=document&template=${encodeURIComponent(tp.id)}`); return; } busy = true; note = null; const r = await api("/api/documents/pdf/from-template", { method: "POST", body: { templateId: tp.id } }); busy = false; if (r.ok) await goto(`/documents/${r.json.instanceId}/edit?from=template`); else note = r.error ?? t("That template could not be used."); }
  async function retire(tp) { if (!await ask(t("Retire “{name}”? It stops being offered; documents already sent are not affected.", { name: tp.name }))) return; const r = await api("/api/documents/pdf/templates/retire", { method: "POST", body: { templateId: tp.id } }); note = r.ok ? t("Retired.") : (r.error ?? t("That did not work.")); await load(); }
  async function approve(tp) { note = null; const r = await api("/api/documents/pdf/templates/approve", { method: "POST", body: { templateId: tp.id } }); note = r.ok ? t("Approved.") : (r.error ?? t("That did not work.")); await load(); }
  async function reject(tp) { const reason = await askText(t("Why is this template being rejected?"), { yes: t("Reject"), required: true }); if (reason === null) return; note = null; const r = await api("/api/documents/pdf/templates/reject", { method: "POST", body: { templateId: tp.id, reason } }); note = r.ok ? t("Rejected.") : (r.error ?? t("That did not work.")); await load(); }
  async function openBulk() { bulkOpen = true; const r = await api("/api/documents/pdf/kiosk-templates"); tpls = r.ok ? (r.json.templates ?? []) : [];
    // Only document templates (one signer) belong here: drop the form templates the kiosk list also carries.
    const dr = await api("/api/documents/pdf/templates?q=&retired=false&kind=document"); const dj = dr.ok ? dr.json : null; const docIds = new Set((dj?.templates ?? dj?.items ?? dj?.data ?? []).map((x) => x.id)); if (dr.ok && docIds.size) tpls = tpls.filter((x) => docIds.has(x.id)); else if (dr.ok) tpls = []; templateId = tpls[0]?.id ?? ""; }
  function onFile(file) { if (!file) return; fileName = file.name; check = null; done = null; bulkProblem = null; Papa.parse(file, { header: true, skipEmptyLines: true, complete: (r) => { if (!r.data.length) bulkProblem = t("That file has no rows."); rows = r.data.slice(0, 1000); }, error: () => (bulkProblem = t("That file could not be read as a spreadsheet (CSV).")) }); }
  async function run(dryRun) {
    busy = true; bulkProblem = null;
    try { const results = []; let offset = 0;
      for (let i = 0; i < rows.length; i += BATCH) { const part = rows.slice(i, i + BATCH); const r = await api("/api/documents/pdf/bulk", { method: "POST", body: { templateId, rows: part, dryRun }, ...(dryRun ? {} : { key: `bulk-${sendKey}-${i}` }) }); if (!r.ok) throw new Error(r.error ?? t("Something went wrong.")); results.push(...r.json.results.map((x) => ({ ...x, row: x.row + offset }))); offset += part.length; }
      const s = { sent: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).length, notEmailed: results.filter((x) => x.ok && x.notEmailed).length, results }; if (dryRun) { check = s; done = null; sendKey = crypto.randomUUID(); } else done = s;
    } catch (e) { bulkProblem = e.message; } finally { busy = false; }
  }
  let onFree = $state(false);   // the Pro sentence is for Free workspaces only
  onMount(async () => { await loadPlan(); onFree = plan.data?.billing?.canUpgrade === true; });   // the one shared plan read, not a second request for the same answer
  onMount(() => live(["templates"], load));
</script>
<svelte:head><title>{t("Templates")} · Docustay</title></svelte:head>
<div class="flex flex-wrap items-center gap-3"><h1 class="text-[length:var(--t-title)] font-medium leading-tight tracking-[-0.02em]">{t("Templates")}</h1>{#if kind === "document"}<span class="ml-auto"><ProLock item="bulk_send" tip={t("Send one template to a list of people from a spreadsheet, one document each.")}>{#snippet children(locked)}<button class="btn" disabled={locked} onclick={openBulk} data-testid="tp-bulk">{t("Send to a list")}</button>{/snippet}</ProLock></span>{/if}<span class={kind === "form" ? "ml-auto" : ""}><NewTemplateLock>{#snippet children(locked)}<a href={kind === "form" ? "/create?mode=form" : "/create?mode=template"} class="btn primary" aria-disabled={locked ? "true" : undefined} data-testid="tp-new">{kind === "form" ? t("New form template") : t("New document template")}</a>{/snippet}</NewTemplateLock></span></div>
<div class="mt-3"><Tabs items={KIND_TABS} value={kind} onchange={setKind} label={t("Kind of template")} testid="tp-kind" /></div>
<p class="mt-1 max-w-2xl text-mute" data-testid="tp-lead">{kind === "form" ? t("A form template is one link that anyone can open, fill in and sign. Every response is its own signed document.") : t("A document template is a document you set up once — its pages, where people sign, who signs — and send to the people you name as often as you like.")}</p>
<div class="mt-3"><TemplateUsage /></div>
<div class="mt-4 flex flex-wrap items-center gap-3"><input class="field !w-60 !py-1.5" placeholder={t("Search templates")} bind:value={q} oninput={reload} aria-label={t("Search templates")} /><label class="flex items-center gap-1.5 text-sm text-mute"><input type="checkbox" bind:checked={retired} onchange={reload} /> {t("Include retired")}</label></div>
{#if problem}<p class="mt-4 text-bad" role="alert">{problem}</p>{:else if !data}<div class="mt-5 grid gap-2" aria-busy="true" role="status" data-testid="tp-loading">{#each [0, 1, 2] as i (i)}<div class="skel h-12 rounded-xl"></div>{/each}<span class="sr-only">{t("Loading…")}</span></div>
{:else if data.templates.length === 0}<div class="mt-6 rounded-2xl border border-dashed border-line p-10 text-center" data-testid={`tp-empty-${kind}`}>{#if kind === "form"}<p class="text-lg font-semibold">{t("No form templates yet")}</p><p class="mx-auto mt-1 max-w-md text-mute">{t("Customize a built-in form template below, upload a PDF, write it or describe it. When you publish it you get a link to share and a snippet for your website.")}</p><span class="mt-5 inline-flex"><NewTemplateLock testid="prolock-new-template-empty">{#snippet children(locked)}<a href="/create?mode=form" class="btn primary" aria-disabled={locked ? "true" : undefined} data-testid="tp-empty-new">{t("New form template")}</a>{/snippet}</NewTemplateLock></span>{:else}<p class="text-lg font-semibold">{t("No document templates yet")}</p><p class="mx-auto mt-1 max-w-md text-mute">{t("Customize a built-in template below, upload a file, write it or describe it.")}</p><span class="mt-5 inline-flex"><NewTemplateLock testid="prolock-new-template-empty">{#snippet children(locked)}<a href="/create?mode=template" class="btn primary" aria-disabled={locked ? "true" : undefined} data-testid="tp-empty-new">{t("New document template")}</a>{/snippet}</NewTemplateLock></span>{/if}</div>
{:else}
  <div class="mt-4 overflow-x-auto rounded-xl border border-line"><table use:cardTable class="card-table w-full min-w-[520px] text-left text-[15px]"><thead class="bg-tint text-xs uppercase tracking-wide text-mute"><tr><th class="px-4 py-2.5">{t("Template")}</th><th class="px-4 py-2.5">{t("Version")}</th><th class="px-4 py-2.5">{t("Updated")}</th><th class="px-4 py-2.5"><span class="sr-only">{t("Actions")}</span></th></tr></thead>
    <tbody use:autoAnimate>{#each data.templates as tp (tp.id)}<tr class="border-t border-line"><td class="px-4 py-3 font-medium">{tp.name}{#if !tp.active}<span class="ml-2 text-xs text-mute">({t("retired")})</span>{/if}{#if kind === "form"}<span class="mt-0.5 block text-xs font-normal text-mute" data-testid="tpl-form-state">{tp.self_serve_enabled && tp.self_serve_slug ? t("Published at /f/…/{slug}", { slug: tp.self_serve_slug }) : t("Not published")}</span>{:else if tp.active}<span class="mt-0.5 block text-xs font-normal text-mute" data-testid="tpl-form-reason">{tp.formReason ? REASON()[tp.formReason] ?? t("It cannot become a form.") : t("Can also be made into a form.")}</span>{/if}</td><td class="px-4 py-3 text-mute">v{tp.version ?? 1}</td><td class="px-4 py-3 text-mute">{when(tp.updated_at ?? tp.created_at)}</td>
      <td class="whitespace-nowrap px-4 py-3 text-right">{#if tp.approval_status === "pending"}<span class="chip" data-testid="tpl-pending">{t("Waiting for approval")}</span>{#if data.can?.approve !== false} <button class="btn primary !py-1.5" onclick={() => approve(tp)} data-testid="tpl-approve">{t("Approve")}</button> <button class="btn !py-1.5" onclick={() => reject(tp)} data-testid="tpl-reject">{t("Reject")}</button>{/if}{:else if tp.approval_status === "rejected"}<span class="chip warn" data-testid="tpl-rejected">{t("Rejected")}</span>{#if tp.approval_note} <span class="text-xs text-mute" data-testid="tpl-reject-reason">{t("Reason: {why}", { why: tp.approval_note })}</span>{/if} {#if data.can?.retire !== false}<button class="btn !py-1.5" onclick={() => retire(tp)}>{t("Retire")}</button>{/if}{:else if tp.active}{#if kind === "form"}<a class="btn primary !py-1.5" href={`/forms?open=${tp.id}`} data-testid="tpl-form-open">{tp.self_serve_enabled ? t("Open in Forms") : t("Publish")}</a> {:else}<button class="btn primary !py-1.5" disabled={busy} onclick={() => use(tp)} data-testid="tpl-use">{t("Use")}</button> {/if}{#if tp.editable && data.can?.retire !== false}<a class="btn !py-1.5" href={`/create/flow?mode=${kind === "form" ? "form" : "template"}&template=${tp.id}`} data-testid="tpl-edit">{t("Edit")}</a> {/if}{#if kind === "document" && !tp.formReason && data.can?.retire !== false}<a class="btn !py-1.5" href={`/forms?new=${tp.id}`} data-testid="tpl-make-form">{t("Make it a form")}</a> {/if}{#if data.can?.retire !== false}<button class="btn !py-1.5" onclick={() => retire(tp)}>{t("Retire")}</button>{/if}{/if}</td></tr>{/each}</tbody></table></div>
{/if}
{#if note}<p class="mt-3 text-sm" role="status">{note}</p>{/if}
{#if data}{#key kind}<LibraryList {kind} {q} {highlight} />{/key}{/if}   <!-- R10-61: drawn after the workspace's own list, so the list arriving never pushes it down the page -->
{#if bulkOpen}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={t("Send to a list")}><div class="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl bg-card p-6">
    <div class="flex items-center"><h2 class="text-xl font-semibold">{t("Send to a list")}</h2><button class="btn ml-auto !py-1" onclick={() => (bulkOpen = false)}>{t("Close")}</button></div>
    <p class="mt-1 text-sm text-mute"><Rich text={t("Pick a template with one signer, add a spreadsheet (CSV) with <code>name</code> and <code>email</code> columns, check the list, send. Each row becomes its own document.")} parts={{ code: { code: true } }} /></p>
    {#if tpls.length === 0}<p class="mt-4 text-sm">{t("You need a saved template with exactly one signer first.")}</p>{:else}
      <div class="mt-4 space-y-3"><Pick options={tpls.map((tp) => ({ value: tp.id, label: tp.name }))} value={templateId} onchange={(v) => { templateId = v; check = null; done = null; sendKey = null; }} label={t("Template")} testid="bulk-template" />
        <label class="btn w-fit cursor-pointer" data-testid="bulk-file"><input class="sr-only" type="file" accept=".csv,text/csv" onchange={(e) => onFile(e.currentTarget.files?.[0])} aria-label={t("CSV file")} />{fileName ? t("Choose another file") : t("Choose a CSV file")}</label>{#if fileName}<p class="text-sm text-mute">{fileName} — {t("{n, plural, one {# row} other {# rows}}", { n: rows.length })}</p>{/if}
        <div class="flex gap-2"><button class="btn" disabled={busy || !rows.length} onclick={() => run(true)}>{t("Check the list")}</button><button class="btn primary" disabled={busy || !check || check.sent === 0 || Boolean(done)} onclick={() => run(false)} data-testid="bulk-send">{done ? t("Sent") : t("Send to {n}", { n: check ? check.sent : rows.length })}</button></div>
        {#if check}<p class="text-sm" role="status">{check.failed ? t("{n, plural, one {# row needs fixing:} other {# rows need fixing:}}", { n: check.failed }) : t("All {n} rows look right.", { n: check.sent })}</p>{#if check.failed}<ul class="text-sm text-bad">{#each check.results.filter((x) => !x.ok) as x}<li>{t("Row {n}: {reason}", { n: x.row + 1, reason: x.error ?? x.reason ?? t("not accepted") })}</li>{/each}</ul>{/if}{/if}
        {#if busy}<Cube after={2000} label={t("Working through the list…")} testid="bulk-cube" />{/if}
        {#if done}<p class="text-sm" role="status">{done.failed ? t("Sent {sent}, {failed} failed.", { sent: done.sent, failed: done.failed }) : t("Sent {sent}.", { sent: done.sent })}</p>{#if done.failed}<ul class="text-sm text-bad" data-testid="bulk-failed">{#each done.results.filter((x) => !x.ok) as x}<li>{t("Row {n}: {reason}", { n: x.row + 1, reason: x.error ?? x.reason ?? t("not accepted") })}</li>{/each}</ul>{/if}{#if done.notEmailed}<p class="notice warn mt-2 text-sm" role="status" data-testid="bulk-not-emailed">{t("{n, plural, one {# person was not emailed: today's email limit was reached. Send them a reminder after midnight UTC.} other {# people were not emailed: today's email limit was reached. Send them a reminder after midnight UTC.}}", { n: done.notEmailed })}</p>{/if}{/if}
        {#if bulkProblem}<p class="text-sm text-bad" role="alert">{bulkProblem}</p>{/if}</div>{/if}
  </div></div>
{/if}
