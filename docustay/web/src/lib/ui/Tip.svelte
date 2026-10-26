<script>
  // A tooltip (Ark Tooltip, MIT) for icon-only buttons and field hints. Wrap the element; the tip text is `text`.
  import { Tooltip } from "@ark-ui/svelte/tooltip";
  import { Portal } from "@ark-ui/svelte/portal";
  let { text, children, placement = "top", openDelay = 250, class: cls = "" } = $props();
</script>
<Tooltip.Root {openDelay} closeDelay={60} positioning={{ placement, gutter: 6 }}>
  <Tooltip.Trigger class={cls}>{#snippet asChild(props)}<span {...props()} class="inline-flex {cls}">{@render children()}</span>{/snippet}</Tooltip.Trigger>
  <Portal><Tooltip.Positioner><Tooltip.Content>{text}</Tooltip.Content></Tooltip.Positioner></Portal>
</Tooltip.Root>
