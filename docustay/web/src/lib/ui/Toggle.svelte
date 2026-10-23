<script>
  // An on/off switch (Ark Switch, MIT). `checked` is bindable; `onchange(bool)` fires on a flip. The label is the row's text; `hint` sits under it. With no visible label, `ariaLabel` gives the switch its accessible name (read by screen readers, found by role + name).
  import { Switch } from "@ark-ui/svelte/switch";
  let { id = "", checked = $bindable(false), onchange = () => {}, label = "", ariaLabel = "", hint = "", disabled = false, testid = "", class: cls = "" } = $props();
</script>
<Switch.Root {checked} {disabled} ids={id ? { hiddenInput: id } : undefined} onCheckedChange={(d) => { checked = d.checked; onchange(d.checked); }} class={cls}>
  <Switch.Control data-testid={testid || undefined}><Switch.Thumb /></Switch.Control>
  {#if label}<span class="grid gap-0.5"><Switch.Label class="text-sm font-medium">{label}</Switch.Label>{#if hint}<span class="text-xs text-mute">{hint}</span>{/if}</span>{/if}
  {#if !label && ariaLabel}<Switch.Label class="sr-only">{ariaLabel}</Switch.Label>{/if}
  <Switch.HiddenInput />
</Switch.Root>
