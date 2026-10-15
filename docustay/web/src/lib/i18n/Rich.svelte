<script>
  // A translated sentence with links or emphasis inside it. The translator moves the tags with the words: "I agree to the <terms>Terms</terms> and <privacy>Privacy Policy</privacy>."
  // `parts` maps a tag name to { href, target } for a link, or { strong: true } for bold. Anything the string does not name is plain text. Never renders HTML from the catalogue: only these named slots exist.
  let { text, parts = {} } = $props();
  const bits = $derived.by(() => {
    const out = []; const re = /<([a-z][a-z0-9]*)>([\s\S]*?)<\/\1>/g; let last = 0, m;
    while ((m = re.exec(text))) { if (m.index > last) out.push({ t: text.slice(last, m.index) }); out.push({ tag: m[1], t: m[2] }); last = re.lastIndex; }
    if (last < text.length) out.push({ t: text.slice(last) }); return out;
  });
</script>
{#each bits as b}{#if b.tag && parts[b.tag]?.href}<a class={parts[b.tag].class ?? "underline"} href={parts[b.tag].href} target={parts[b.tag].target} rel={parts[b.tag].target === "_blank" ? "noopener" : undefined}>{b.t}</a>{:else if b.tag && parts[b.tag]?.strong}<strong>{b.t}</strong>{:else if b.tag && parts[b.tag]?.code}<code class="break-all">{b.t}</code>{:else if b.tag && parts[b.tag]?.em}<em>{b.t}</em>{:else}{b.t}{/if}{/each}
