<script>
  import Figure from "./Figure.svelte";
  import { proShown, dollars } from "../plans.js";
  // "How many do you send?": a slider over documents a month. Every number is read from plans.js (what the pricing page already shows); the page says which plan the number fits and what it costs.
  let { p } = $props(); let docs = $state(8), team = $state(1);
  const pro = $derived(proShown(p)), free = $derived(p.free.docsPerMonth);
  const fits = $derived(docs <= free && team <= 1);
  const why = $derived(docs > free ? `${docs} is over the ${free} documents a month that Free sends.` : team > 1 ? "Free is for one person, the owner. A team needs Pro." : `${docs} a month fits the Free plan, for one person.`);
</script>
<Figure caption="FIG. 01 · WHICH PLAN FITS" note="MOVE THE SLIDERS">
  <div class="pc">
    <label>Documents sent a month <b>{docs}</b><input type="range" min="1" max="60" bind:value={docs} aria-label="Documents sent a month" /></label>
    <label>People who send <b>{team}</b><input type="range" min="1" max="12" bind:value={team} aria-label="People who send" /></label>
    <div class="out" class:pro={!fits} aria-live="polite"><span>{fits ? "FREE" : "PRO"}</span><p><b>{fits ? dollars(0) : dollars(pro.monthlyMinor)} a month</b>{#if !fits}, flat for the whole workspace{#if pro.founders} (founders price; list {dollars(pro.listMonthlyMinor)}){/if}{/if}</p><small>{why}{#if !fits} Pro has no document limit and no per-person price.{/if}</small></div>
  </div>
</Figure>
<style>
  .pc { display: grid; gap: 22px; padding: 6px 4px; } label { display: grid; gap: 8px; font: 500 14px var(--font-sans); color: #c9c5bb; } label b { font: 600 22px var(--font-sans); color: #f4f2ec; margin-left: 8px; } input[type="range"] { width: 100%; min-height: 24px; accent-color: #8585fd; }
  .out { border: 1px solid #2a2a2c; border-radius: 6px; padding: 18px 20px; background: #131315; display: grid; gap: 6px; } .out span { font: 600 11px var(--font-mono); letter-spacing: .14em; color: #8f8a80; } .out.pro span { color: #8585fd; } .out p { margin: 0; font-size: 22px; } .out small { color: #a9a59b; font-size: 14px; line-height: 1.55; }
</style>
