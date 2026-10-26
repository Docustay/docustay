<script>
  // The assistant's words, as streamed markdown. Renders with svelte-streamdown 4.2.1 (MIT, Copyright (c) Streamdown contributors; github.com/beynar/svelte-streamdown), core only (no maths, no diagrams): half-written syntax
  // never flickers while text arrives. OUR safety rule is kept: raw HTML is shown as plain text (Streamdown's default, renderHtml is never set), and a link is only followed if it is https, mailto or an in-app path.
  import { Streamdown } from "svelte-streamdown";
  import { goto } from "$app/navigation";
  import { t } from "$lib/i18n/index.svelte.js";
  let { text = "", streaming = false, onnavigate = () => {} } = $props();
  // Run 8 (motion board Working 6): new words settle in from a soft blur while the answer streams. Reduced motion or a slow device: words appear as they arrive.
  const still = typeof window !== "undefined" && (matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.hasAttribute("data-lite"));
  const safe = (h) => { const s = String(h ?? ""); return /^\/(?!\/)/.test(s) || /^https:\/\//i.test(s) || /^mailto:/i.test(s); };
  const inApp = (h) => /^\/(?!\/)/.test(String(h ?? ""));
  function go(e, href) { if (!inApp(href) || e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; e.preventDefault(); onnavigate(href); goto(href); }
  let copied = $state("");
  async function copy(code) { try { await navigator.clipboard.writeText(code); copied = code; setTimeout(() => { if (copied === code) copied = ""; }, 1600); } catch { /* no clipboard: the text can still be selected */ } }
  const theme = { paragraph: { base: "md-p" }, ul: { base: "md-ul" }, ol: { base: "md-ol" }, li: { base: "md-li", checkbox: "md-li" }, strong: { base: "md-strong" }, em: { base: "md-em" }, h1: { base: "md-h" }, h2: { base: "md-h" }, h3: { base: "md-h" }, h4: { base: "md-h" }, h5: { base: "md-h" }, h6: { base: "md-h" }, codespan: { base: "md-codespan" }, blockquote: { base: "md-quote" }, hr: { base: "md-hr" } };
</script>
<div class="md" data-testid="chat-response">
  <Streamdown content={text} parseIncompleteMarkdown={true} baseTheme="tailwind" {theme} controls={false} animation={{ enabled: streaming && !still, type: "blur", duration: 380, timingFunction: "ease-out", tokenize: "word", animateOnMount: false }} defaultOrigin="https://docustay.invalid" translations={{ controls: { blockedUrl: t("Blocked link"), linkBlocked: t("Blocked link") } }}>
    {#snippet link({ children, token })}
      {#if safe(token.href)}<a href={token.href} class="md-link" target={inApp(token.href) ? undefined : "_blank"} rel={inApp(token.href) ? undefined : "noopener noreferrer"} onclick={(e) => go(e, token.href)}>{@render children()}</a>{:else}<span>{@render children()}</span>{/if}
    {/snippet}
    {#snippet code({ token })}
      <div class="md-code"><div class="md-code-bar"><span>{token.lang || ""}</span><button type="button" class="md-copy" onclick={() => copy(token.text)} data-testid="chat-copy-code">{copied === token.text ? t("Copied") : t("Copy")}</button></div><pre tabindex="0"><code>{token.text.replace(/\n+$/, "")}</code></pre></div>
    {/snippet}
  </Streamdown>
</div>
<style>
  .md { overflow-wrap: anywhere; line-height: 1.5; font-size: .94rem; }
  .md :global(.md-p) { margin: 0 0 .55rem; }
  .md :global(.md-p:last-child) { margin-bottom: 0; }
  .md :global(.md-ul), .md :global(.md-ol) { margin: 0 0 .55rem; padding-left: 1.25rem; }
  .md :global(.md-ul) { list-style: disc; }
  .md :global(.md-ol) { list-style: decimal; }
  .md :global(.md-li) { margin: .15rem 0; }
  .md :global(.md-strong) { font-weight: 650; }
  .md :global(.md-em) { font-style: italic; }
  .md :global(.md-h) { margin: .6rem 0 .3rem; font-weight: 650; font-size: 1rem; }
  .md :global(.md-codespan) { background: var(--tint); border-radius: 4px; padding: .05rem .3rem; font-size: .85em; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .md :global(.md-quote) { margin: 0 0 .55rem; padding-left: .75rem; border-left: 3px solid var(--line-strong); color: var(--mute); }
  .md :global(.md-hr) { border: 0; border-top: 1px solid var(--line); margin: .6rem 0; }
  .md :global(.md-link) { color: var(--brand); text-decoration: underline; text-underline-offset: 2px; }
  .md-code { margin: 0 0 .55rem; border: 1px solid var(--line); border-radius: 8px; background: var(--tint); overflow: hidden; }
  .md-code-bar { display: flex; align-items: center; justify-content: space-between; padding: .2rem .5rem; font-size: .75rem; color: var(--mute); border-bottom: 1px solid var(--line); }
  .md-copy { background: none; border: 0; color: var(--brand); cursor: pointer; font: inherit; min-height: 28px; padding: 0 .25rem; }
  .md-code pre { margin: 0; padding: .5rem .65rem; overflow-x: auto; font-size: .82rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
</style>
