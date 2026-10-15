<script>
  import Hero from "$lib/site/Hero.svelte"; import Cta from "$lib/site/Cta.svelte";
  let name = $state(""), email = $state(""), message = $state(""), website = $state(""), busy = $state(false), done = $state(false), problem = $state(null);
  async function send(e) {
    e.preventDefault(); busy = true; problem = null;
    try {
      const r = await fetch("/api/public/docustay/contact", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, email, message, website }) });
      const j = await r.json().catch(() => null);
      if (r.ok) done = true; else problem = j?.error?.message ?? j?.message ?? "That could not be sent. Please try again later.";
    } catch { problem = "That could not be sent. Please check your connection and try again."; }
    busy = false;
  }
</script>
<svelte:head><title>Contact | Docustay</title><meta name="description" content="Write to the Docustay team." /></svelte:head>
<Hero eyebrow="CONTACT" title="Contact" lede="Questions, a problem, or something you want to see. We build Docustay and we read every message." />
<div class="cwrap d-wrap"><div class="cform card">
  {#if done}<p class="notice ok" role="status" data-testid="contact-done">Thank you. Your message was sent and we will reply to {email}.</p>
  {:else}
  <form class="space-y-4" onsubmit={send}>
    <div><label class="label" for="cn">Your name</label><input id="cn" class="field" bind:value={name} autocomplete="name" required maxlength="120" /></div>
    <div><label class="label" for="ce">Email</label><input id="ce" class="field" type="email" bind:value={email} autocomplete="email" required maxlength="200" /></div>
    <div><label class="label" for="cm">Message</label><textarea id="cm" class="field" rows="6" bind:value={message} required minlength="10" maxlength="5000"></textarea></div>
    <div class="absolute -left-[9999px]" aria-hidden="true"><label>Leave this empty<input tabindex="-1" autocomplete="off" bind:value={website} /></label></div>
    {#if problem}<p class="notice bad" role="alert">{problem}</p>{/if}
    <button class="btn primary" disabled={busy}>{busy ? "Sending…" : "Send"}</button>
    <p class="text-sm text-mute">We use your name and address only to reply. The message is emailed to us and not stored on this site.</p>
  </form>{/if}
  </div><aside><h2 class="aside-h">Who to write to</h2><p class="mt-3 text-sm text-mute">Security reports: <a class="underline" href="mailto:security@docustay.app">security@docustay.app</a>. Privacy requests: <a class="underline" href="mailto:privacy@docustay.app">privacy@docustay.app</a>.</p></aside></div>
<section class="d-wrap after"><h2 class="aside-h">What happens next</h2><p>A person reads your message, usually the same working day, and replies to the address you gave. If it is a problem, tell us what you did, what you expected and what happened, and include a document id if you have one. Never send a password or an API key.</p><p>For pricing, licensing and embedding questions, say what you want to build and roughly how many documents a month. See <a href="/pricing">pricing</a>, <a href="/licensing">licensing</a> and <a href="/self-host">self-hosting</a>.</p></section>
<Cta title="Prefer to try it?" text="" href="/signup" label="Get started free" keep={[["Pricing", "/pricing"], ["Docs", "/docs"], ["Trust", "/trust"]]} />
<style>
  .aside-h { font: 600 22px/1.2 var(--font-sans); letter-spacing: -.02em; } .after { margin-top: 56px; max-width: 70ch; } .after p { color: #a8a39a; line-height: 1.65; margin-top: 12px; } .after a { color: #f4f2ec; text-decoration: underline; }
.cwrap { display: grid; grid-template-columns: minmax(0, 32rem) 1fr; gap: clamp(2rem, 6vw, 5rem); margin-top: clamp(2rem, 5vw, 4rem); align-items: start; } .cform { padding: clamp(1.4rem, 3vw, 2.2rem); border-radius: var(--r-5); } aside { padding-top: 1rem; } @media (max-width: 900px) { .cwrap { grid-template-columns: minmax(0, 1fr); } } @media (max-width: 799px) { .cwrap { grid-template-columns: 1fr; } }</style>
