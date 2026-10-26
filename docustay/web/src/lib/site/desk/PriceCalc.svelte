<script>
  import Figure from "./Figure.svelte";
  import { planCosts, dollars } from "../plans.js";
  // "Which plan fits you?" (SIGNWITH 5.19): three sliders over the one price list. Free fits only for one team member inside its limits; Pay as you go is team members x the team member price plus documents and drafts past the included amount;
  // Pro is flat plus drafts past its included amount. The cheapest says "Best for you". Signers are never charged. The maths is plans.js `planCosts`, tested in test/v1_pricing_calc.test.mjs.
  let { p } = $props(); let people = $state(3), docs = $state(42), drafts = $state(18), signers = $state(10);
  const r = $derived(planCosts(p, { people, docs, drafts, signers }));
  const cheapest = (k) => r.best === k;
</script>
<Figure caption="FIG. 01 · WHICH PLAN FITS" note="MOVE THE SLIDERS">
  <div class="pc" data-testid="price-calc">
    <label>Team members <b>{people}</b><input type="range" min="1" max="20" bind:value={people} aria-label="Team members" /></label>
    <label>Documents sent a month <b>{docs}</b><input type="range" min="0" max="500" bind:value={docs} aria-label="Documents sent a month" /></label>
    <label>Different signers a month <b>{signers}</b><input type="range" min="0" max="100" bind:value={signers} aria-label="Different signers a month" /></label>
    <label>AI drafts a month <b>{drafts}</b><input type="range" min="0" max="200" bind:value={drafts} aria-label="AI drafts a month" /></label>
    <p class="note">A team member is anyone who signs in to send or manage. A signer is anyone you send to, and signers never cost anything.</p>
    <div class="res" aria-live="polite">
      <div class="out" class:best={cheapest("free")} data-plan="free"><span>FREE</span>{#if r.free.fits}<p><b>{dollars(0)} a month</b></p><small>{#if cheapest("free")}<em>Best for you</em>. {/if}One team member, up to {p.free.docsPerMonth} documents, {p.free.signersPerMonth} different signers and {p.free.draftsPerMonth} drafts.</small>{:else}<p><b>Over the limit</b></p><small>Free is one team member, {p.free.docsPerMonth} documents, {p.free.signersPerMonth} different signers and {p.free.draftsPerMonth} drafts a month.</small>{/if}</div>
      <div class="out" class:best={cheapest("payg")} data-plan="payg"><span>PAY AS YOU GO</span><p><b>{dollars(r.payg.total)} a month</b></p><small>{#if cheapest("payg")}<em>Best for you</em>. {/if}{people} team member{people === 1 ? "" : "s"} × {dollars(p.payg.personMonthlyMinor)} = {dollars(r.payg.people)}{#if r.payg.docs}, plus documents past {p.payg.docsIncluded}: {dollars(r.payg.docs)}{/if}{#if r.payg.drafts}, plus drafts past {p.payg.draftsIncluded}: {dollars(r.payg.drafts)}{/if}.</small></div>
      <div class="out" class:best={cheapest("pro")} data-plan="pro"><span>PRO</span><p><b>{dollars(r.pro.total)} a month</b></p><small>{#if cheapest("pro")}<em>Best for you</em>. {/if}{dollars(r.pro.base)} flat for the whole workspace{#if r.pro.drafts}, plus drafts past {p.pro.draftsIncluded}: {dollars(r.pro.drafts)}{/if}. Unlimited documents, signers and team members.</small></div>
    </div>
  </div>
</Figure>
<style>
  .pc { display: grid; gap: 22px; padding: 6px 4px; } label { display: grid; gap: 8px; font: 500 14px var(--font-sans); color: var(--tx-2); } label b { font: 600 22px var(--font-sans); color: var(--tx-1); margin-left: 8px; } input[type="range"] { width: 100%; min-height: 24px; accent-color: #5a3ac1; }
  .note { margin: -8px 0 0; font-size: 13px; color: var(--tx-3); }
  .res { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; } @media (max-width: 760px) { .res { grid-template-columns: minmax(0, 1fr); } }
  .out { border: 1px solid var(--hairline); border-radius: 6px; padding: 16px 18px; background: #ffffff; display: grid; gap: 6px; align-content: start; } .out span { font: 600 11px var(--font-mono); letter-spacing: .14em; color: var(--tx-3); } .out.best { border-color: var(--v-700); box-shadow: 0 0 0 3px rgb(90 58 193 / .12); } .out.best span { color: var(--v-700); } .out p { margin: 0; font-size: 20px; } .out small { color: var(--tx-3); font-size: 13.5px; line-height: 1.55; } .out em { font-style: normal; font-weight: 600; color: var(--v-700); }
</style>
