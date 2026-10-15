<script>
  import { page } from "$app/state";
  import Logo from "$lib/Logo.svelte";
  const missing = $derived(page.status === 404);
</script>
<svelte:head><title>{missing ? "Page not found" : "Something went wrong"} · Docustay</title><meta name="robots" content="noindex" /></svelte:head>
<main class="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-6 py-16" data-testid="error-page">
  <Logo />
  <p class="font-mono text-[13px] uppercase tracking-[0.08em] text-mute">{page.status}</p>
  <h1 class="text-[32px] font-medium leading-tight tracking-[-0.02em]">{missing ? "That page isn’t here" : "Something went wrong"}</h1>
  <p class="text-[16px] leading-relaxed text-mute">{missing ? "The address may be mistyped, or the page has moved. These will get you back on track." : "Try again in a moment. If it keeps happening, tell us and we will look."}</p>
  <div class="mt-2 flex flex-wrap gap-3">
    <a class="btn primary" href="/">Home</a>
    <a class="btn" href="/docs">Documentation</a>
    <a class="btn" href="/pricing">Pricing</a>
    <a class="btn" href="/contact">Contact us</a>
  </div>
</main>
