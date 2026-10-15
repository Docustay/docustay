<script>
  // A menu (Ark Menu, MIT) for row actions and the account menu. items: [{ label, icon?, onselect, danger?, disabled?, hint? } | { separator: true } | { group: "Label" }]. The trigger is the `trigger` snippet or an ellipsis button.
  import { Menu } from "@ark-ui/svelte/menu";
  import { Portal } from "@ark-ui/svelte/portal";
  import Icon from "./Icon.svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  let { items = [], trigger = null, label = "", placement = "bottom-end", testid = "", class: cls = "" } = $props();
</script>
<Menu.Root positioning={{ placement }}>
  <Menu.Trigger class={trigger ? cls : `btn quiet !min-h-0 !p-2 ${cls}`} aria-label={label || t("More")} data-testid={testid || undefined}>{#if trigger}{@render trigger()}{:else}<Icon name="ellipsis" size={18} />{/if}</Menu.Trigger>
  <Portal>
    <Menu.Positioner>
      <Menu.Content>
        {#each items as it, i (i)}
          {#if it.separator}<Menu.Separator />
          {:else if it.group}<Menu.ItemGroup><Menu.ItemGroupLabel>{it.group}</Menu.ItemGroupLabel></Menu.ItemGroup>
          {:else}<Menu.Item value={String(it.value ?? it.label)} disabled={it.disabled} data-danger={it.danger ? "" : undefined} onSelect={() => it.onselect?.()} data-testid={it.testid}>{#if it.icon}<Icon name={it.icon} size={16} />{/if}<span>{it.label}</span>{#if it.hint}<span class="ml-auto text-xs text-faint">{it.hint}</span>{/if}</Menu.Item>{/if}
        {/each}
      </Menu.Content>
    </Menu.Positioner>
  </Portal>
</Menu.Root>
