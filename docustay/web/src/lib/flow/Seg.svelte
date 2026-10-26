<script>
  // A short either/or choice drawn as buttons, so one click makes the change (a dropdown costs two). An option may carry a colour dot (a person).
  let { options = [], value = "", onchange = () => {}, label = "", testid = "", disabled = false, inline = false } = $props();
</script>
<div role="group" aria-label={label} class={inline ? "flex flex-wrap items-center gap-2" : ""}>
  {#if label}<p class={inline ? "text-sm text-mute" : "mb-1 text-sm"}>{label}</p>{/if}
  <div class="flex flex-wrap gap-1.5">
    {#each options as o (o.value)}
      <button type="button" class="btn !min-h-9 !py-1 !px-3 text-sm {value === o.value ? 'primary' : ''}" aria-pressed={value === o.value} {disabled} onclick={() => onchange(o.value)} data-testid={testid ? `${testid}-${o.value}` : undefined}>{#if o.dot}<span class="mr-1.5 inline-block size-2.5 rounded-full" style="background:{o.dot}" aria-hidden="true"></span>{/if}{o.label}</button>
    {/each}
  </div>
</div>
