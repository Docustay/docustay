<script>
  // A white sheet with a soft shadow. `tilt` in degrees (at most 1.2 except the hero sheets), `float` seconds (7 or 8) or 0.
  let { tilt = 0, float = 0, class: cls = "", style = "", children } = $props();
</script>
<div class="paper {float === 7 ? 'float7' : float === 8 ? 'float8' : ''} {cls}" style="transform: rotate({tilt}deg); {style}">{@render children()}</div>
