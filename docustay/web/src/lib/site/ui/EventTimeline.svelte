<script>
  // The document timeline card: sent, opened, signed, sealed, then the webhook line. `rows`: [{ s, t, tone? }] (tone "ok" = green dot). `hook` is the cyan product-UI line.
  let { rows, hook = "", title = "Document timeline", note = "sample data", class: cls = "" } = $props();
</script>
<div class="et {cls}">
  <div class="hd"><span>{title}</span><small>{note}</small></div>
  <ol>{#each rows as r}<li><i class:ok={r.tone === "ok"}></i>{r.s}<time>{r.t}</time></li>{/each}</ol>
  {#if hook}<div class="hook">{hook}</div>{/if}
</div>
<style>
  .et { width: 100%; box-sizing: border-box; padding: 18px 20px; border-radius: var(--r-4); border: 1px solid var(--ln-2); background: rgb(255 255 255 / 0.85); box-shadow: var(--sh-2), inset 0 1px 0 rgb(255 255 255 / .08); text-align: left; }
  .hd { display: flex; justify-content: space-between; align-items: center; font-size: 14px; font-weight: 500; } .hd small { font: 11px var(--f-mono); color: var(--tx-3); font-weight: 400; }
  ol { list-style: none; margin: 14px 0 0; padding: 0; display: flex; flex-direction: column; gap: 11px; font-size: 13.5px; color: var(--tx-2); } li { display: flex; align-items: center; gap: 10px; } li i { width: 8px; height: 8px; border-radius: 50%; background: var(--v-400); flex: none; } li i.ok { background: var(--ok); } time { margin-left: auto; font: 11.5px var(--f-mono); color: var(--tx-3); }
  .hook { margin-top: 14px; padding: 9px 11px; border-radius: 10px; background: var(--cyan-soft); border: 1px solid rgb(11 111 122 / .28); font: 11.5px var(--f-mono); color: var(--cyan); overflow-wrap: anywhere; }
</style>
