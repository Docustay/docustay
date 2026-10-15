<script>
  // Boxes joined by dashed connectors that march: the email domain steps, self-host parts. steps: [{ title, line?, icon?, state?: done|todo|current }]
  import Icon from "./Icon.svelte";
  let { steps = [], vertical = false } = $props();
</script>
<ol class="flex {vertical ? 'flex-col' : 'flex-col md:flex-row'} items-stretch gap-0" data-testid="flow">
  {#each steps as s, i (i)}
    <li class="flex {vertical ? 'flex-col' : 'flex-col md:flex-row'} flex-1 items-stretch">
      <div class="flex-1 rounded-xl border bg-card p-4 {s.state === 'current' ? 'border-[var(--accent-line)] shadow-[0_0_0_3px_var(--accent-soft)]' : 'border-line-strong'}"><div class="flex items-center gap-2 font-medium">{#if s.icon}<Icon name={s.icon} size={16} />{/if}{s.title}{#if s.state === "done"}<Icon name="circle-check" size={16} class="text-ok" />{/if}</div>{#if s.line}<p class="mt-1 text-sm text-mute">{s.line}</p>{/if}</div>
      {#if i < steps.length - 1}<span class="march {vertical ? 'mx-auto h-6 w-px' : 'mx-auto my-0 h-6 w-px md:mx-0 md:my-auto md:h-px md:w-8'}" style={vertical ? "background-image:linear-gradient(var(--line-strong) 50%,transparent 0);background-size:1px 8px;background-repeat:repeat-y" : ""} aria-hidden="true"></span>{/if}
    </li>
  {/each}
</ol>
