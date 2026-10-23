<script>
  // EXPLORE PRO (Run 8, motion board 2 piece 3): a small sheet that rises from the control that opened it — what Pro adds (the one list, which names the item that was pressed first), and one
  // button to the website's Pro section and pricing. On a phone it rises from the bottom. Mounted once in the signed-in layout; any ProLock or Pro card opens it. Never blocks: Escape, the
  // close button or a press outside closes it, and focus goes back to the control.
  import { tick } from "svelte";
  import Icon from "$lib/ui/Icon.svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  import { proSheet, closeProSheet, openUpgrade } from "./proSheet.svelte.js";
  import { EXPLORE_PRO_URL, plan } from "./plan.svelte.js";
  let card = $state(null), opener = null;
  const ITEMS = $derived([
    ["unlimited_documents", t("Unlimited documents")], ["unlimited_templates", t("Unlimited new templates")], ["unlimited_people", t("Unlimited team members and signers")],
    ["custom_plays", t("Your own plays and playbooks, and the Plays API")],
  ]);
  const ALIAS = { plays_api: "custom_plays", team_roles: "unlimited_people", template_limit: "unlimited_templates", document_limit: "unlimited_documents" };
  const first = $derived(ALIAS[proSheet.item] ?? proSheet.item);
  const list = $derived([...ITEMS.filter(([k]) => k === first), ...ITEMS.filter(([k]) => k !== first)].slice(0, 5));
  const canUpgrade = $derived(plan.data?.billing?.canUpgrade === true);
  const style = $derived.by(() => {
    const f = proSheet.from; if (!f || typeof window === "undefined" || window.innerWidth < 641) return "";
    const w = 320, left = Math.max(12, Math.min(window.innerWidth - w - 12, f.x - w / 2)), below = f.y + 10, up = window.innerHeight - below < 340;
    return up ? `left:${left}px;bottom:${Math.max(12, window.innerHeight - f.top + 10)}px;transform-origin:${f.x - left}px 100%` : `left:${left}px;top:${below}px;transform-origin:${f.x - left}px 0`;
  });
  $effect(() => { if (proSheet.open) { opener = document.activeElement; tick().then(() => card?.querySelector("[data-autofocus]")?.focus()); } });
  function close() { closeProSheet(); tick().then(() => { if (opener instanceof HTMLElement && document.contains(opener)) opener.focus(); }); }
  function key(e) { if (proSheet.open && e.key === "Escape") { e.preventDefault(); close(); } }
  function outside(e) { if (proSheet.open && card && !card.contains(e.target) && !e.target.closest?.("[data-testid^='prolock']")) close(); }
</script>
<svelte:window onkeydown={key} onpointerdown={outside} />
{#if proSheet.open}
  <div class="xp" bind:this={card} {style} role="dialog" aria-modal="false" aria-labelledby="xp-title" data-testid="explore-pro">
    <div class="hd"><span id="xp-title">Docustay Pro</span><button type="button" class="x" aria-label={t("Close")} data-testid="explore-pro-close" onclick={close}><Icon name="close" size={16} /></button></div>
    <ul class="bd">{#each list as [k, label] (k)}<li class:first={k === first}><span class="ck" aria-hidden="true"><Icon name="check" size={14} /></span>{label}</li>{/each}</ul>
    <div class="ft">
      <a class="go" href={EXPLORE_PRO_URL} target="_blank" rel="noopener" data-autofocus data-testid="explore-pro-plans">{t("See Pro plans")}</a>
      {#if canUpgrade}<button type="button" class="up" data-testid="explore-pro-upgrade" onclick={() => openUpgrade(proSheet.item)}>{t("Choose Pro")}</button>{/if}
    </div>
  </div>
{/if}
<style>
  .xp { position: fixed; z-index: 80; width: 320px; max-width: calc(100vw - 24px); border-radius: 16px; background: var(--card, #fff); color: var(--ink); box-shadow: 0 20px 50px rgb(40 25 100 / .18), 0 0 0 1px var(--line); overflow: hidden; animation: xp-rise 260ms var(--ease-out, cubic-bezier(.2,.8,.2,1)); }
  .hd { height: 72px; display: flex; align-items: flex-end; justify-content: space-between; padding: 0 12px 12px 18px; color: #fff; font-weight: 600; font-size: 16px; background: linear-gradient(110deg, #5A3AC1 30%, #8f86ff 50%, #5A3AC1 70%); background-size: 220% 100%; animation: xp-sheen 3s linear infinite; }
  .x { width: 32px; height: 32px; display: grid; place-items: center; border: 0; border-radius: 8px; background: rgb(255 255 255 / .16); color: #fff; cursor: pointer; }
  .bd { list-style: none; margin: 0; padding: 14px 18px 4px; display: grid; gap: 10px; font-size: 13.5px; }
  .bd li { display: flex; gap: 8px; align-items: flex-start; } .bd li.first { font-weight: 600; }
  .ck { color: var(--brand, #5a3ac1); display: inline-grid; margin-top: 1px; }
  .ft { padding: 12px 18px 16px; display: grid; gap: 6px; }
  .go { display: block; text-align: center; padding: 10px; border-radius: 10px; background: var(--brand, #5a3ac1); color: #fff; text-decoration: none; font-weight: 500; }
  .go:hover { filter: brightness(1.06); color: #fff; }
  .up { text-align: center; font-size: 13px; color: var(--brand); background: none; border: 0; cursor: pointer; }
  @keyframes xp-rise { from { opacity: 0; transform: translateY(8px) scale(.97); } to { opacity: 1; transform: none; } }
  @keyframes xp-sheen { 0% { background-position: -160% 0; } 100% { background-position: 160% 0; } }
  @media (max-width: 640px) { .xp { left: 0 !important; right: 0; bottom: 0 !important; top: auto !important; width: 100%; max-width: 100%; border-radius: 18px 18px 0 0; padding-bottom: env(safe-area-inset-bottom, 0px); } }
  @media (prefers-reduced-motion: reduce) { .xp, .hd { animation: none; } }
  :global(html[data-lite]) .hd { animation: none; }
</style>
