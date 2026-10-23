<script>
  // "Ask an AI about this page": four links that open the assistant with this page's address and a question. Plain links (no script), so they work everywhere.
  import { page } from "$app/state";
  let { subject = "this page" } = $props();
  const url = $derived("https://docustay.app" + page.url.pathname);
  const q = $derived(encodeURIComponent(`Read ${url} and explain in plain words what ${subject} means for someone using Docustay. Quote the parts that matter.`));
  const links = $derived([["ChatGPT", `https://chatgpt.com/?q=${q}`], ["Claude", `https://claude.ai/new?q=${q}`], ["Gemini", `https://www.google.com/search?udm=50&q=${q}`], ["Perplexity", `https://www.perplexity.ai/search?q=${q}`]]);
</script>
<aside class="ai" aria-label="Ask an AI about this page"><p><b>Ask an AI about this page</b><span>Opens an assistant with this page's address and a question. We do not send anything else.</span></p>
  <div>{#each links as [n, h]}<a href={h} rel="noopener noreferrer" target="_blank" data-umami-event="outbound_click" data-umami-event-domain={new URL(h).hostname}>{n}</a>{/each}</div></aside>
<style>
  .ai { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px 24px; padding: 18px 22px; border-radius: var(--r-4); border: 1px solid var(--ln-2); background: rgb(255 255 255 / 0.85); } .ai p { margin: 0; display: grid; gap: 4px; } .ai b { font-weight: 500; } .ai span { font-size: 14px; color: var(--tx-3); }
  .ai div { display: flex; flex-wrap: wrap; gap: 8px; } .ai a { display: inline-flex; align-items: center; min-height: 40px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--ln-2); color: var(--tx-1); text-decoration: none; font-size: 14px; } .ai a:hover { border-color: var(--v-300); }
  @media print { .ai { display: none; } }
</style>
