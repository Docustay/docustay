<script>
  import Cta from "$lib/site/Cta.svelte";
  import Hero from "$lib/site/Hero.svelte";
  let { data } = $props();
  const WORD = { operational: "Operational", outage: "Not working", unreachable: "Cannot be reached" };
  const headline = $derived(data.live.status === "operational" ? "Everything is working" : data.live.status === "degraded" ? "Something is not working" : "We cannot reach the service just now");
</script>
<svelte:head><title>Status | Docustay</title><meta name="description" content="Whether Docustay is working right now, and what happened when it was not." /></svelte:head>
<Hero title="Status" lede="Whether Docustay is working right now." art={["check", "star", "pencil"]} />
<section class="mt-8 max-w-3xl" data-testid="status">
  <p class="banner {data.live.status}" role="status" data-testid="status-headline">{headline}</p>
  <ul class="parts">{#each data.live.components as c (c.key)}<li data-testid={`status-${c.key}`}><span>{c.name}</span><b class={c.status}>{WORD[c.status] ?? c.status}</b></li>{/each}</ul>
  <p class="checked">Checked {new Date(data.live.checkedAt).toUTCString().replace("GMT", "UTC")}. This page asks the service itself, every few seconds at most.</p>
  <h2 class="t-h3 mt-10">Past incidents</h2>
  {#if data.incidents.length}
    <ol class="log">{#each data.incidents as i}<li><time>{i.date}</time><div><b>{i.title}</b> <span class="chip">{i.status}</span><p>{i.body}</p></div></li>{/each}</ol>
  {:else}<p class="mt-2 text-mute" data-testid="status-no-incidents">No incidents reported.</p>{/if}
  <h2 class="t-h3 mt-10">How this is measured</h2>
  <p class="mt-2 text-mute">Each line above comes from a check the service runs on itself: the app and API answering, the database, the worker that sends email and seals documents, and file storage. A line says Not working when its check fails, and Cannot be reached when the check itself cannot run. Nothing is averaged or hidden, and an incident is listed here with its date once it has happened.</p>
  <p class="mt-8 text-sm text-mute">Something wrong that is not here? Write to <a href="mailto:support@docustay.app">support@docustay.app</a> with the request id from the error.</p>
</section>
<Cta title="See what changed." text="" href="/changelog" label="Changelog" keep={[["Security", "/trust#security"], ["Sub-processors", "/trust#sub-processors"], ["Contact", "/contact"]]} />
<style>
  .banner { padding: .9rem 1.1rem; border-radius: 12px; font-weight: 600; background: var(--ok-bg); color: var(--ok); border: 1px solid var(--ok-line); }
  .banner.degraded, .banner.unreachable { background: var(--warn-bg); color: var(--warn); border-color: var(--warn-line); }
  .parts { list-style: none; padding: 0; margin: 1rem 0 0; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
  .parts li { display: flex; justify-content: space-between; gap: 1rem; padding: .85rem 1.1rem; border-top: 1px solid var(--line); } .parts li:first-child { border-top: 0; }
  .parts b.operational { color: var(--ok); } .parts b.outage, .parts b.unreachable { color: var(--bad); }
  .checked { color: var(--mute); font-size: .9rem; margin-top: .7rem; }
  .log { list-style: none; padding: 0; margin: 1rem 0 0; } .log li { display: grid; grid-template-columns: 8rem 1fr; gap: 1rem; padding: .8rem 0; border-top: 1px solid var(--line); } time { color: var(--mute); }
</style>
