<script>
  import PageSkel from "$lib/ui/PageSkel.svelte";
  // The review queue for "Suggest a better translation". Only the people the platform names (the Docustay viewers) can open it; anyone else gets the server's refusal in plain words.
  import { onMount } from "svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  import { api } from "$lib/api.js";
  import { toast } from "$lib/ui/toast.js";
  let status = $state("new"), rows = $state([]), loading = $state(true), problem = $state(null), notes = $state({});
  const STATUSES = ["new", "approved", "rejected", "applied"];
  async function load() { loading = true; problem = null; try { rows = (await api(`/api/product/docustay/translation-suggestions?status=${status}`)).suggestions ?? []; } catch (e) { problem = e.message; rows = []; } loading = false; }
  async function review(r, decision) { try { await api(`/api/product/docustay/translation-suggestions/${r.id}/review`, { method: "POST", body: { decision, note: notes[r.id] ?? "" } }); toast(decision === "approve" ? t("Approved.") : t("Rejected.")); await load(); } catch (e) { toast(e.message, "bad"); } }
  async function patch() { try { const p = await api("/api/product/docustay/translation-suggestions/patch"); const blob = new Blob([JSON.stringify(p, null, 1)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "translation-patch.json"; a.click(); URL.revokeObjectURL(a.href); } catch (e) { toast(e.message, "bad"); } }
  const words = (s) => (s ?? "").split(/(\s+)/);
  /** a small word-by-word diff of the current text against the suggestion: removed words struck through, added words highlighted */
  function diff(a, b) { const A = words(a), B = words(b); const m = A.length, n = B.length; const L = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0)); for (let i = m - 1; i >= 0; i -= 1) for (let j = n - 1; j >= 0; j -= 1) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]); const out = []; let i = 0, j = 0; while (i < m && j < n) { if (A[i] === B[j]) { out.push({ k: "same", s: A[i] }); i += 1; j += 1; } else if (L[i + 1][j] >= L[i][j + 1]) { out.push({ k: "del", s: A[i] }); i += 1; } else { out.push({ k: "add", s: B[j] }); j += 1; } } while (i < m) out.push({ k: "del", s: A[i++] }); while (j < n) out.push({ k: "add", s: B[j++] }); return out; }
  onMount(load);
</script>
<svelte:head><title>{t("Translation suggestions")}</title></svelte:head>
<div class="flex flex-wrap items-center gap-3"><h1 class="text-[length:var(--t-title)] font-medium leading-tight tracking-[-0.02em]">{t("Translation suggestions")}</h1>
  <div class="ml-auto flex items-center gap-2"><select class="field !min-h-9 !w-auto !py-1 text-sm" bind:value={status} onchange={load} aria-label={t("Status")}>{#each STATUSES as s}<option value={s}>{s}</option>{/each}</select>
    <button class="btn quiet" onclick={patch}>{t("Download the approved patch")}</button></div></div>
{#if problem}<p class="notice bad mt-4" role="alert">{problem}</p>
{:else if loading}<div class="mt-6"><PageSkel kind="list" testid="translations-loading" /></div>
{:else if rows.length === 0}<p class="mt-6 rounded-lg border border-dashed border-line p-6 text-center text-mute" data-testid="queue-empty">{t("Nothing here.")}</p>
{:else}
  <ul class="mt-4 grid gap-3" data-testid="queue">
    {#each rows as r (r.id)}
      <li class="rounded-lg border border-line bg-card p-4">
        <div class="flex flex-wrap items-center gap-2 text-xs text-mute"><span class="chip mute">{r.lang}</span><span>{r.surface}</span><span>{new Date(r.created_at).toLocaleString()}</span>{#if r.email}<span>{r.email}</span>{/if}<span class="ml-auto chip mute">{r.status}</span></div>
        <p class="mt-2 text-sm"><span class="text-mute">English:</span> {r.source_key}</p>
        <p class="mt-1 text-sm leading-relaxed" data-testid="diff">{#each diff(r.current_text, r.suggested_text) as d}{#if d.k === "del"}<del class="bg-red-500/15 text-red-700 dark:text-red-300">{d.s}</del>{:else if d.k === "add"}<ins class="bg-emerald-500/20 no-underline">{d.s}</ins>{:else}{d.s}{/if}{/each}</p>
        {#if r.note}<p class="mt-1 text-sm text-mute">“{r.note}”</p>{/if}
        {#if r.status === "new"}
          <div class="mt-3 flex flex-wrap items-center gap-2"><input class="field !min-h-9 flex-1 text-sm" placeholder={t("Note (optional)")} bind:value={notes[r.id]} />
            <button class="btn" onclick={() => review(r, "approve")}>{t("Approve")}</button><button class="btn quiet" onclick={() => review(r, "reject")}>{t("Reject")}</button></div>
        {/if}
      </li>
    {/each}
  </ul>
{/if}
