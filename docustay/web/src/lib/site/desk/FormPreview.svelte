<script>
  // Run 7: a form template drawn the way the person with the link sees it: each field's label, an empty box of the right kind (a line, ticks for choices, a file button, a signature box), and
  // its help line. Built from the same parse as the field list (forms.gen.json), so the picture can never show a field the form does not have. `limit` shows only the first sections.
  let { f, limit = null } = $props();
  const sections = $derived(limit ? f.sections.slice(0, limit) : f.sections);
  const filler = $derived(f.roles[0]);
  const kind = (t) => (t === "choice" || t === "choose any" ? "pick" : t === "tick box" ? "tick" : t === "signature" ? "sign" : t.startsWith("file") ? "file" : t === "date signed" ? "auto" : "line");
</script>
<div class="fp" data-product-visual="form" data-testid="form-preview" aria-label={`${f.title}: the form as people see it`} role="img">
  <p class="fp-h">{f.title}</p>
  <p class="fp-i">{f.intro}</p>
  {#each sections as s}
    <p class="fp-s">{s.heading}</p>
    {#each s.fields as x}
      <div class="fp-f">
        <span class="fp-l">{x.label}{x.required ? "" : " (optional)"}{x.role !== filler ? ` · ${x.role}` : ""}</span>
        {#if kind(x.type) === "pick" && x.options}<span class="fp-o">{#each x.options.slice(0, 6) as o}<span><i class={x.type === "choice" ? "r" : ""}></i>{o}</span>{/each}</span>
        {:else if kind(x.type) === "tick"}<span class="fp-o"><span><i></i>{x.help ?? "Yes"}</span></span>
        {:else if kind(x.type) === "sign"}<span class="fp-sig">Sign here</span>
        {:else if kind(x.type) === "file"}<span class="fp-file">Attach a PDF or a picture</span>
        {:else if kind(x.type) === "auto"}<span class="fp-auto">Filled in when they sign</span>
        {:else}<span class="fp-in"></span>{/if}
        {#if x.help && kind(x.type) !== "tick"}<span class="fp-hp">{x.help}</span>{/if}
      </div>
    {/each}
  {/each}
  {#if !limit}<p class="fp-i" data-testid="fp-count">{f.fieldCount} fields for the person filling it in{f.counterFields ? `, plus ${f.counterFields} for the team member` : ""}.</p>{/if}
</div>
<style>
  .fp { background: #fff; color: #1b1b1b; border: 1px solid #e3ddd0; border-radius: 8px; padding: 26px 26px 20px; box-shadow: 0 18px 40px -24px rgb(0 0 0 / .45); }
  .fp-h { margin: 0; font: 600 19px/1.25 var(--font-sans); } .fp-i { margin: 6px 0 4px; color: #4a4740; font-size: 14px; line-height: 1.55; }
  .fp-s { margin: 20px 0 6px; font: 600 11.5px/1 var(--font-mono); letter-spacing: .1em; text-transform: uppercase; color: #5a3ac1; }
  .fp-f { display: grid; gap: 5px; margin: 10px 0; } .fp-l { font-size: 13.5px; font-weight: 600; } .fp-hp { font-size: 12.5px; color: #5a564e; line-height: 1.45; }
  .fp-in { display: block; height: 34px; border: 1px solid #cfc8b8; border-radius: 5px; background: #fdfcf9; }
  .fp-o { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 13px; color: #2b2925; } .fp-o span { display: inline-flex; align-items: center; gap: 6px; }
  .fp-o i { width: 13px; height: 13px; border: 1.5px solid #8a8274; border-radius: 3px; display: inline-block; } .fp-o i.r { border-radius: 50%; }
  .fp-sig { display: flex; align-items: flex-end; height: 58px; padding: 0 10px 8px; border: 1.5px dashed #5a3ac1; border-radius: 6px; background: #f6f3ff; color: #4c2fb0; font: 500 12px/1 var(--font-mono); }
  .fp-file { display: inline-block; width: fit-content; padding: 8px 12px; border: 1px solid #cfc8b8; border-radius: 5px; font-size: 13px; color: #2b2925; background: #fdfcf9; }
  .fp-auto { font: 500 12px/1.4 var(--font-mono); color: #5a564e; }
  @media (max-width: 600px) { .fp { padding: 18px; } }
</style>
