<script>
  // The bot check: Cloudflare Turnstile, shown only when this deployment has a site key, and only asking anything of the visitor when Cloudflare is unsure (interaction-only).
  // It hands the one-time token to the page; a token is spent by exactly one server call, so the page asks for a fresh one with reset().
  let { siteKey = null, ontoken = () => {} } = $props();
  let box = $state(null), id = null;
  export function reset() { try { if (id !== null) window.turnstile?.reset(id); } catch { /* the widget was already gone */ } ontoken(null); }
  $effect(() => {
    if (!siteKey || !box) return;
    const draw = () => { try { id = window.turnstile.render(box, { sitekey: siteKey, appearance: "interaction-only", size: window.innerWidth < 400 ? "compact" : "normal", callback: (tk) => ontoken(tk), "expired-callback": () => ontoken(null), "error-callback": () => ontoken(null) }); } catch { /* no widget: the server then treats this visit as unverified and holds it to the tighter limit */ } };
    if (window.turnstile) draw();
    else { const s = document.createElement("script"); s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; s.async = true; s.onload = draw; document.head.appendChild(s); }
    return () => { try { if (id !== null) window.turnstile?.remove(id); } catch { /* ignore */ } };
  });
</script>
{#if siteKey}<div bind:this={box} data-testid="bot-check"></div>{/if}
