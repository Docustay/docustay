<script>
  // Questions and answers as real <details>: keyboard and screen-reader friendly with no script; the answer fades in when opened.
  let { items } = $props();
</script>
<div class="faq">{#each items as [q, a]}<details><summary>{q}</summary><p>{a}</p></details>{/each}</div>
<style>
  .faq { border-top: 1px solid var(--line); }
  details { border-bottom: 1px solid var(--line); }
  summary { cursor: pointer; list-style: none; display: flex; justify-content: space-between; gap: 1rem; padding: 1.15rem .25rem; font-size: 1.12rem; font-weight: 550; }
  summary::-webkit-details-marker { display: none; }
  summary::after { content: "+"; font-size: 1.5rem; line-height: 1; color: var(--brand); transition: transform var(--dur-base) var(--ease-out); }
  details[open] summary::after { transform: rotate(45deg); }
  summary:hover { color: var(--brand); }
  p { margin: 0; padding: 0 .25rem 1.3rem; color: var(--mute); line-height: 1.7; max-width: 46rem; animation: fade var(--dur-base) var(--ease-out); }
  @keyframes fade { from { opacity: 0; transform: translateY(-4px); } }
</style>
