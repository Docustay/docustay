<script>
  // A one-time code box (Ark Pin Input, MIT): paste fills every box, backspace steps back. `onComplete(code)` fires when all boxes are filled.
  import { PinInput } from "@ark-ui/svelte/pin-input";
  let { length = 6, value = $bindable(""), onComplete = () => {}, invalid = false, label = "", testid = "" } = $props();
  const chars = $derived(value ? [...value].slice(0, length) : []);
</script>
<PinInput.Root count={length} value={chars} otp {invalid} onValueChange={(d) => (value = d.value.join(""))} onValueComplete={(d) => onComplete(d.value.join(""))} data-testid={testid || undefined}>
  {#if label}<PinInput.Label class="label">{label}</PinInput.Label>{/if}
  <PinInput.Control>{#each Array.from({ length }, (_, i) => i) as i (i)}<PinInput.Input index={i} />{/each}</PinInput.Control>
  <PinInput.HiddenInput />
</PinInput.Root>
