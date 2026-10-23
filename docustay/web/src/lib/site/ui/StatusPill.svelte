<script>
  // The footer status pill: operational, degraded, or "see details". It NEVER logs an error: a failed or blocked status call just shows the neutral state (staging has no API behind it).
  import { onMount } from "svelte";
  let { status = $bindable("checking"), href = "/status" } = $props();
  const text = $derived(status === "ok" ? "All systems operational" : status === "degraded" ? "Degraded performance" : "Status: see details");
  onMount(async () => {
    if (status !== "checking") return;
    // the status API exists only behind docustay.app; on staging and previews there is nothing to ask, and a 502 would put an error in every console
    if (!/(^|\.)docustay\.app$/.test(location.hostname)) { status = "unknown"; return; }
    try { const r = await fetch("/api/public/status", { headers: { accept: "application/json" } }).catch(() => null); if (!r || !r.ok) { status = "unknown"; return; } const j = await r.json().catch(() => null); status = j?.status === "ok" || j?.status === "operational" ? "ok" : j?.status ? "degraded" : "unknown"; } catch { status = "unknown"; }
  });
</script>
<a class="sp {status}" {href} data-testid="status-pill"><i></i>{text}</a>
<style>
  .sp { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; min-height: 28px; border-radius: 999px; border: 1px solid var(--ln-2); color: var(--tx-1); font-size: 13.5px; text-decoration: none; } .sp i { width: 7px; height: 7px; border-radius: 50%; background: var(--tx-3); }
  .sp.ok i { background: var(--ok); box-shadow: 0 0 8px var(--ok); } .sp.degraded { border-color: rgb(255 180 84 / .4); } .sp.degraded i { background: var(--warn); box-shadow: 0 0 8px var(--warn); }
</style>
