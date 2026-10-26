<script>
  // Loads a heavy component after the page has painted and the browser is idle (or at once when `now` says a person needs it), instead of shipping it in the first download of every screen.
  // The app's shell used to carry Scribe, the ⌘K palette and the two Pro sheets in its first script (about 300 KB before it could draw); on a phone that is most of the wait. Nothing about them changes: they are mounted a moment later.
  import { whenIdle } from "$lib/fx/index.js";
  let { load, now = false } = $props();
  let C = $state(null), started = false;
  const go = () => { if (started) return; started = true; load().then((m) => { C = m.default; }); };
  $effect(() => { if (now) go(); });
  // wait until the screen has had time to fetch and show its own data (a slow phone shares one narrow pipe), THEN fetch these
  $effect(() => { whenIdle(() => setTimeout(go, 8000)); });   // R10-60: 8 s, not 3: a first tap right after the screen shows no longer lands on top of these mounts (a person who wants one sooner starts it at once through `now`)
</script>
{#if C}<C />{/if}
