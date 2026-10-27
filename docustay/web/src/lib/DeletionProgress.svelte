<script>
  // 26 Oct 2026: the screen shown from the moment an owner presses "Delete now" until the workspace is gone. The steps are the real stages of the deletion; each one waits for the server before it is ticked, and the last tick is the moment this very page is signed out.
  import { t } from "$lib/i18n/index.svelte.js";
  import { onMount, onDestroy } from "svelte";
  import { fade, fly, scale } from "svelte/transition";
  let { name = "" } = $props();
  const steps = [t("Cancelling the plan"), t("Revoking API keys and webhooks"), t("Removing documents and files"), t("Signing everyone out")];
  let shown = $state(0), allowed = $state(1), finished = $state(false), failed = $state(false), tick, poll;
  onMount(() => {
    tick = setInterval(() => { if (shown < allowed) shown += 1; if (finished && shown >= 4) { clearInterval(tick); setTimeout(() => location.assign("/login?signedout=deleted"), 1400); } }, 850);
    const ask = async () => {
      try {
        const r = await fetch("/api/account/deletion", { credentials: "same-origin", headers: { accept: "application/json" } });
        if (r.status === 401) { finished = true; allowed = 4; clearInterval(poll); return; }
        const j = await r.json().catch(() => null);
        const ws = j?.workspace;
        if (!ws) { finished = true; allowed = 4; clearInterval(poll); return; }
        if (ws.status === "failed") { failed = true; }
        allowed = ws.progress === "working" ? 3 : 2;
      } catch { /* try again on the next beat */ }
    };
    ask(); poll = setInterval(ask, 1200);
  });
  onDestroy(() => { clearInterval(tick); clearInterval(poll); });
</script>
<div class="space-y-4 rounded-xl border border-bad p-5" role="status" aria-live="polite" data-testid="delete-progress" in:fade={{ duration: 200 }}>
  <h2 class="text-lg font-semibold">{t("Deleting {name}", { name })}</h2>
  <ol class="space-y-2">
    {#each steps as label, i}
      <li class="flex items-center gap-3 text-sm" data-testid="delete-step-{i + 1}" data-done={shown > i} in:fly={{ y: 8, duration: 250, delay: i * 80 }}>
        <span class="inline-flex h-6 w-6 items-center justify-center rounded-full border border-line" aria-hidden="true">
          {#if shown > i}<svg in:scale={{ duration: 260, start: 0.4 }} class="h-4 w-4 text-ok" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 10.5l4 4 8-9" stroke-linecap="round" stroke-linejoin="round" /></svg>
          {:else if shown === i}<span class="h-3 w-3 animate-spin rounded-full border-2 border-mute border-t-transparent"></span>{/if}
        </span>
        <span class={shown > i ? "" : "text-mute"}>{label}</span>
      </li>
    {/each}
  </ol>
  {#if failed}<p class="notice warn" role="alert">{t("One step did not finish. It will be tried again in a few minutes; your workspace stays closed meanwhile.")}</p>{/if}
  {#if finished && shown >= 4}<p class="text-sm" in:fade data-testid="delete-progress-done">{t("This workspace was deleted. Taking you to sign-in.")}</p>{/if}
</div>
