<script>
  // The "Try the demo" button for /demo. States: idle, loading (the demo workspace is being built: the button works and says so), busy (the demo is at its limit: a friendly "try again in a few minutes" with a countdown that re-enables the button), and error (the app did not answer).
  // Two ways to learn the demo is busy, neither blocks anyone when the app says nothing: the app sends a visitor back here with ?state=busy&retry=<seconds> when it refuses a start, and this page asks /api/public/demo/status once (a 404 or no answer means "go ahead").
  import { onMount } from "svelte";
  let { url = "https://app.docustay.app/demo", variant = "hero", label = "Try the demo", probe = false } = $props();
  let state = $state("idle"), left = $state(0), timer = null;
  const tick = () => { left -= 1; if (left <= 0) { clearInterval(timer); state = "idle"; } };
  function busy(seconds) { state = "busy"; left = Math.max(5, Math.min(900, Number(seconds) || 120)); clearInterval(timer); timer = setInterval(tick, 1000); }
  onMount(() => {
    const q = new URLSearchParams(location.search);
    if (q.get("state") === "busy") busy(q.get("retry"));
    else if (q.get("state") === "error") state = "error";
    else if (variant === "hero" && probe) {
      const ac = new AbortController(), to = setTimeout(() => ac.abort(), 2500);
      fetch("/api/public/demo/status", { signal: ac.signal, headers: { accept: "application/json" } }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.available === false) busy(j.retryAfterSeconds); }).catch(() => {}).finally(() => clearTimeout(to));
    }
    return () => clearInterval(timer);
  });
  function go(e) { if (state === "loading") { e.preventDefault(); return; } if (state === "busy") { e.preventDefault(); return; } state = "loading"; setTimeout(() => { if (document.visibilityState === "visible") state = "idle"; }, 12000); }   // the page is left when the app answers; if it never does, the button comes back
  const mm = $derived(`${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`);
</script>
<div class="cta {variant}" data-state={state}>
  {#if state === "busy"}
    <div class="note" role="status"><b>The demo is busy right now.</b><span>Try again in a few minutes. This button comes back in <time>{mm}</time>.</span></div>
    <a class="dm-btn go" href={url} aria-disabled="true" tabindex="-1" onclick={go}>{label}</a>
  {:else}
    <a class="dm-btn go" href={url} onclick={go} aria-busy={state === "loading"} data-umami-event="demo_button_{variant}" data-testid="demo-cta-{variant}">
      {#if state === "loading"}<span class="spin" aria-hidden="true"></span>Building your demo…{:else}<svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7.25" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".55" /><path d="M6.4 5.1v5.8L11 8z" fill="currentColor" /></svg>{label}{/if}
    </a>
    {#if state === "error"}<p class="note err" role="alert"><b>The demo did not start.</b><span>Please try again, or sign up free and look around in a real workspace.</span></p>{/if}
  {/if}
  <a class="alt" href="/signup" data-umami-event="signup_click_demo_{variant}">or sign up free</a>
</div>
<style>
  .cta { display: flex; flex-wrap: wrap; align-items: center; gap: 14px 18px; margin-top: 30px; }
  .dm-btn { position: relative; isolation: isolate; overflow: hidden; display: inline-flex; align-items: center; justify-content: center; gap: 10px; min-height: 56px; padding: 16px 28px; border-radius: 12px; font: 600 17px/1 var(--font-sans); color: #fff; text-decoration: none; background: linear-gradient(180deg, #6a49e0, #4e30b2); box-shadow: inset 0 0 0 1px rgb(90 58 193 / 0.193), 0 14px 40px -12px rgb(90 58 193 / 0.22); transition: transform .15s, box-shadow .2s, filter .2s; }
  .dm-btn::after { content: ""; position: absolute; inset: 0; z-index: -1; background: linear-gradient(105deg, transparent 30%, rgb(255 255 255 / .3) 50%, transparent 70%); transform: translateX(-120%); transition: transform .7s ease; }
  .dm-btn:hover { transform: translateY(-3px); filter: brightness(1.08); box-shadow: inset 0 0 0 1px rgb(90 58 193 / 0.22), 0 20px 50px -12px rgb(90 58 193 / 0.22); } .dm-btn:hover::after { transform: translateX(120%); }
  .dm-btn:active { transform: translateY(0) scale(.98); } .dm-btn:focus-visible { outline: 2px solid var(--v-700); outline-offset: 4px; }
  .dm-btn[aria-busy="true"], .dm-btn[aria-disabled="true"] { cursor: progress; filter: saturate(.8); } .dm-btn[aria-disabled="true"] { cursor: not-allowed; opacity: .45; filter: grayscale(.5); pointer-events: none; }
  .spin { width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgb(255 255 255 / .35); border-top-color: #fff; animation: dm-spin .8s linear infinite; }
  @keyframes dm-spin { to { transform: rotate(360deg); } }
  .alt { display: inline-flex; align-items: center; min-height: 32px; padding: 0 2px; color: var(--d-muted); font-size: 15px; text-decoration: underline; text-underline-offset: 4px; } .alt:hover { color: var(--d-text); } .alt:focus-visible { outline: 2px solid var(--v-700); outline-offset: 3px; border-radius: 4px; }
  .note { flex: 1 1 100%; display: grid; gap: 4px; margin: 0; padding: 14px 16px; border-radius: 10px; border: 1px solid var(--hairline); background: #ffffff; color: var(--d-muted); font-size: 14.5px; line-height: 1.5; } .note b { color: var(--d-text); font-weight: 600; } .note.err { border-color: #7a3b3b; }
  .note time { font-family: var(--font-mono); color: var(--v-700); }
  .cta.closing { justify-content: center; }
  @media (prefers-reduced-motion: reduce) { .dm-btn, .dm-btn::after { transition: none; } .dm-btn:hover { transform: none; } .spin { animation-duration: 2.4s; } }
  @media (max-width: 520px) { .dm-btn { width: 100%; } }
</style>
