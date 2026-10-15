<script>
  // LAUNCH step 2: "Continue with Google" (Google Identity Services). Drawn only when this deployment has a Google web client (authConfig().google); Google's own button, in the person's language, hands back a credential
  // that auth.js trades for a sign-in. The script loads on demand from accounts.google.com (the entry pages' policy allows exactly that, hooks.server.js) and never on any signed-in page.
  import { onMount } from "svelte";
  import { i18n } from "$lib/i18n/index.svelte.js";
  let { clientId = null, oncredential = () => {}, onerror = () => {}, width = 320 } = $props();
  let box = $state(null), shown = $state(false);
  onMount(() => {
    if (!clientId) return;
    const draw = () => {
      try {
        window.google.accounts.id.initialize({ client_id: clientId, callback: (r) => r?.credential && oncredential(r.credential), ux_mode: "popup", auto_select: false, use_fedcm_for_prompt: true });
        window.google.accounts.id.renderButton(box, { type: "standard", theme: "outline", size: "large", text: "continue_with", shape: "pill", width, locale: i18n.lang });
        shown = true;
      } catch (e) { onerror(e); }
    };
    if (window.google?.accounts?.id) draw();
    else { const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true; s.onload = draw; s.onerror = () => onerror(new Error("blocked")); document.head.appendChild(s); }
  });
</script>
{#if clientId}<div class="g" data-testid="google-button" data-ready={shown}><div bind:this={box} style="min-height: 44px"></div></div>{/if}
<style>.g { display: flex; justify-content: center; }</style>
