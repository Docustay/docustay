<script>
  import { whenVisible } from "./reveal.js";
  // The real first page of a template with every field on it drawn where the app puts it (positions are the template's own, from starters.gen.json). Fields come in role by role; a legend says who fills what.
  let { starter, title = "", fields = null } = $props(); const d = $derived(fields); let run = $state(false);
  const COLORS = ["#8585fd", "#3a5fe5", "#2f9e5a", "#c98a14"]; const NAME = { signature: "Signature", initials: "Initials", date_signed: "Date signed", text: "Text", dropdown: "Dropdown", checkbox: "Checkbox", date: "Date", number: "Number", email: "Email", phone: "Phone", payment: "Payment", multiselect: "Choice", image: "Picture", file: "File", stamp: "Stamp", zip: "Zip" };
</script>
{#if d}
<div class="df" {@attach whenVisible((v) => { if (v) run = true; })} class:run data-docfields={starter}>
  <div class="pg"><picture><source type="image/webp" srcset="/starters/{starter}/p1-sm.webp" /><img src="/starters/{starter}/p1-sm.jpg" width="440" height="569" alt="First page of the {title || d.title} template, with its fields marked" loading="lazy" /></picture>
    {#each d.p1 as f, i}<i class="f" style="left:{f.x * 100}%;top:{f.y * 100}%;width:{f.w * 100}%;height:{Math.max(f.h * 100, 1.4)}%;--c:{COLORS[Math.max(0, f.r) % 4]};--d:{Math.min(i, 24) * 55}ms" title="{NAME[f.t] ?? f.t}: {f.l}"></i>{/each}</div>
  <div class="sm"><p class="big"><b>{d.total}</b> fields on <b>{d.pages}</b> {d.pages === 1 ? "page" : "pages"}</p>
    <ul class="lg">{#each d.roles as r, i}<li><s style="background:{COLORS[i % 4]}"></s>{r}</li>{/each}</ul>
    <dl>{#each Object.entries(d.byType).sort((a, b) => b[1] - a[1]) as [k, n]}<div><dt>{NAME[k] ?? k}</dt><dd>{n}</dd></div>{/each}</dl></div>
</div>
{/if}
<style>
  .df { display: grid; grid-template-columns: minmax(0, 250px) minmax(0, 1fr); gap: 22px; align-items: start; } .pg { position: relative; background: #faf8f3; border-radius: 3px; box-shadow: 0 30px 60px rgb(0 0 0 / .55); aspect-ratio: 440 / 569; overflow: hidden; } .pg img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .f { position: absolute; border: 1.5px solid var(--c); background: color-mix(in srgb, var(--c) 16%, transparent); border-radius: 2px; opacity: 0; } .run .f { animation: fin .45s cubic-bezier(.2, .8, .2, 1) both; animation-delay: var(--d); } @keyframes fin { from { opacity: 0; transform: scale(1.25); } to { opacity: 1; } } .df:not(.run) .f { opacity: 1; }
  .sm .big { margin: 0 0 14px; font: 500 15px var(--font-sans); color: #b4afa5; } .sm .big b { font: 600 28px/1 var(--font-sans); color: #f4f2ec; letter-spacing: -.02em; margin-right: 4px; } .lg { list-style: none; padding: 0; margin: 0 0 16px; display: flex; flex-wrap: wrap; gap: 8px 18px; font: 500 13.5px var(--font-sans); } .lg s { display: inline-block; width: 11px; height: 11px; border-radius: 2px; margin-right: 7px; vertical-align: -1px; }
  dl { margin: 0; display: grid; } dl > div { display: flex; justify-content: space-between; padding: 8px 0; border-top: 1px solid #222224; font-size: 14.5px; } dt { color: #b4afa5; } dd { margin: 0; font: 500 13.5px var(--font-mono); }
  @media (max-width: 700px) { .df { grid-template-columns: 1fr; } .pg { max-width: 330px; } }
</style>
