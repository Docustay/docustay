<script>
  // A soft coloured light behind something: place inside a relative parent.
  let { size = 28, tone = "var(--accent)", opacity = 0.25, class: cls = "" } = $props();
</script>
<div class="pointer-events-none absolute left-1/2 top-1/2 -z-10 -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl {cls}" style="width:{size}rem;height:{size}rem;background:{tone};opacity:{opacity}" aria-hidden="true"></div>
