<script>
  let { tone = "note", label = "", class: cls = "", children } = $props();
</script>
<div class="co {tone} {cls}" role="note">{#if label}<b>{label}</b> {/if}{@render children?.()}</div>
<style>
  .co { padding: 12px 16px; border-radius: var(--r-3); border: 1px solid rgb(90 58 193 / .3); background: #fff; color: var(--tx-2); font-size: 15px; line-height: 1.55; } .co b { color: var(--tx-1); font-weight: 500; margin-right: .35em; }
  .warn { border-color: rgb(138 82 8 / .35); background: #fdf7ee; color: #5b3a0a; } .bad { border-color: rgb(180 35 60 / .35); background: #fdf1f3; color: #7d1a2c; }
</style>
