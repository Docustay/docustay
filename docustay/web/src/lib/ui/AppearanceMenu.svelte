<script>
  // The Appearance menu (report §17.1, Ark Menu): System, Light, Dark. Light is the default and shows checked. Sits in the sidebar footer and in the docs sidebar.
  import { Menu } from "@ark-ui/svelte/menu";
  import { Portal } from "@ark-ui/svelte/portal";
  import Icon from "./Icon.svelte";
  import { theme } from "$lib/theme/theme.svelte.js";
  import { t } from "$lib/i18n/index.svelte.js";
  let { placement = "right-end", full = false, class: cls = "" } = $props();
  const OPTIONS = $derived([["system", t("System"), "globe"], ["light", t("Light"), "sun"], ["dark", t("Dark"), "moon"]]);
</script>
<Menu.Root positioning={{ placement }}>
  <Menu.Trigger class="btn quiet {full ? '!justify-start' : '!min-h-0 !p-2'} {cls}" aria-label={t("Appearance")} data-testid="appearance-trigger"><Icon name={theme.resolved === "dark" ? "moon" : "sun"} size={18} />{#if full}<span>{t("Appearance")}</span>{/if}</Menu.Trigger>
  <Portal>
    <Menu.Positioner>
      <Menu.Content data-testid="appearance-menu">
        <Menu.ItemGroup><Menu.ItemGroupLabel>{t("Appearance")}</Menu.ItemGroupLabel></Menu.ItemGroup>
        <Menu.RadioItemGroup value={theme.preference} onValueChange={(d) => theme.set(d.value)}>
          {#each OPTIONS as [v, label, icon] (v)}
            <Menu.RadioItem value={v} data-testid="appearance-{v}"><Icon name={icon} size={16} /><span>{label}</span><Menu.ItemIndicator><Icon name="check" size={14} /></Menu.ItemIndicator></Menu.RadioItem>
          {/each}
        </Menu.RadioItemGroup>
      </Menu.Content>
    </Menu.Positioner>
  </Portal>
</Menu.Root>
