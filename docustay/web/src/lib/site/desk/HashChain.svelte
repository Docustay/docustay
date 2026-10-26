<script>
  import { onMount } from "svelte";
  // The hash-chain demo: four records, each hash covers its own text AND the hash before it. Change one letter and every record after it stops matching. Real SHA-256 through Web Crypto, computed in your browser.
  const base = ["Services Agreement, version 1", "Signed by Ada at 09:20", "Signed by Grace at 09:41", "Sealed at 09:58"];
  let texts = $state([...base]), hashes = $state(["", "", "", ""]), orig = $state(["", "", "", ""]);
  const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
  async function run(list) { const out = []; let prev = ""; for (const t of list) { prev = await sha(prev + "|" + t); out.push(prev); } return out; }
  onMount(async () => { orig = await run(base); hashes = [...orig]; });
  async function edit(i, v) { texts[i] = v; hashes = await run(texts); }
  const ok = (i) => hashes[i] && hashes[i] === orig[i];
  const first = $derived(hashes.findIndex((h, i) => h && h !== orig[i]));
</script>
<div class="hc" data-hash-chain>
  {#each texts as t, i}
    {#if i > 0}<span class="ar" aria-hidden="true">↓</span>{/if}
    <div class="blk {hashes[i] && !ok(i) ? 'bad' : ''}">
      <label><span class="k">RECORD {i + 1}</span><input value={t} oninput={(e) => edit(i, e.currentTarget.value)} aria-label="Record {i + 1} text" spellcheck="false" /></label>
      <code class="h">{hashes[i] || "…"}</code><span class="st">{!hashes[i] ? "" : ok(i) ? "MATCHES THE SEAL" : first === i ? "CHANGED HERE" : "BROKEN: AN EARLIER RECORD CHANGED"}</span>
    </div>
  {/each}
  <button type="button" class="reset" onclick={() => { texts = [...base]; hashes = [...orig]; }}>Put it back</button>
</div>
<style>
  .hc { display: grid; gap: 6px; max-width: 520px; } .ar { text-align: center; color: var(--tx-3); font: 500 14px/1 var(--font-mono); }
  .blk { border: 1.2px solid rgb(244 242 236 / .7); padding: 12px 14px; display: grid; gap: 6px; background: rgb(22 22 29 / 0.03); } .blk.bad { border-color: rgb(90 58 193 / 0.5); background: rgb(90 58 193 / 0.05); }
  .k { display: block; font: 500 10px/1 var(--font-mono); letter-spacing: .12em; color: var(--tx-3); margin-bottom: 6px; } input { width: 100%; background: transparent; border: 0; border-bottom: 1px dashed var(--hairline); color: var(--tx-1); font: 500 15px/1.4 var(--font-sans); padding: 2px 0 5px; }
  .h { font: 500 12px/1 var(--font-mono); color: var(--tx-3); } .st { font: 500 10px/1 var(--font-mono); letter-spacing: .1em; color: #1c7448; } .bad .st { color: var(--v-700); } .reset { justify-self: start; margin-top: 10px; background: none; border: 1px solid var(--hairline); color: var(--tx-1); border-radius: 6px; padding: 9px 14px; font: 500 13px/1 var(--font-sans); cursor: pointer; min-height: 40px; }
</style>
