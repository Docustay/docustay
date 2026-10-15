<script>
  // A number that counts up when it scrolls into view (Svelte's Tween). The final number is in the server's HTML; with reduced motion, or without script, it simply shows.
  import { Tween } from "svelte/motion";
  import { cubicOut } from "svelte/easing";
  import { calm } from "./index.js";
  let { to, prefix = "", suffix = "", duration = 1400, class: cls = "" } = $props();
  const t = new Tween(0, { duration, easing: cubicOut });
  let armed = $state(false), live = $state(false);
  const start = (el) => {
    if (calm() || typeof IntersectionObserver === "undefined") { armed = true; return; }
    armed = true; live = true;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { seen = true; io.disconnect(); } }, { threshold: 0.6 });
    io.observe(el); return () => io.disconnect();
  };
  // D-033: the number shown must be THE number. (1) Once it has counted up, a later change of `to` (a new date range, a refresh) moves it too — it used to stay at the first value.
  // (2) A tween driven by animation frames stalls when the tab is in the background or the browser throttles frames (a headless run, a hidden tab), leaving a half-way number on screen:
  //     a timer lands it on the real value shortly after the animation should have ended, whatever the frames did.
  let seen = $state(false), settle = null;
  const land = (target) => { clearTimeout(settle); settle = setTimeout(() => t.set(target, { duration: 0 }), duration + 250); };
  $effect(() => { const target = to; if (live && seen) { t.set(target); land(target); } });
  // D-033b (Run 10, R10-10): until the count-up has actually started (the number scrolled into view) the real number shows — a page whose data arrives after it mounts, or a pane the observer never reports on, showed 0 for a document that had been sent
  const shownValue = $derived(live && seen ? Math.round(t.current) : to);
</script>
<span class={cls} data-count data-armed={armed ? "" : null} {@attach start}>{prefix}{shownValue.toLocaleString("en-US")}{suffix}</span>
