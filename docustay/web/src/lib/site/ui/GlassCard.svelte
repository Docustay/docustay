<script>
  // The three glass recipes (BLUEPRINT §1), white frosted paper on the cream site: obsidian (body, blur 8), smoked (menus and modals, blur 24), indigo (header and hero, blur 16).
  // Blur is the expensive part: use `blur` only on at most THREE surfaces in view at once. Without blur the card is a translucent fill with an alpha hairline.
  let { recipe = "obsidian", blur = false, pad = 24, radius = 20, tag = "div", class: cls = "", children, ...rest } = $props();
</script>
<svelte:element this={tag} class="gc {recipe} {cls}" class:bl={blur} style="--pad:{pad}px;--rad:{radius}px" {...rest}>{@render children?.()}</svelte:element>
<style>
  .gc { position: relative; box-sizing: border-box; padding: var(--pad); border-radius: var(--rad); min-width: 0; box-shadow: var(--sh-card); }
  .obsidian { background: var(--glass-obsidian-bg); border: 1px solid var(--glass-obsidian-edge); } .smoked { background: var(--glass-smoked-bg); border: 1px solid var(--glass-smoked-edge); } .indigo { background: var(--glass-indigo-bg); border: 1px solid var(--glass-indigo-edge); }
  @supports (backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)) {
    .obsidian.bl { backdrop-filter: blur(var(--glass-obsidian-blur)); -webkit-backdrop-filter: blur(var(--glass-obsidian-blur)); } .smoked.bl { backdrop-filter: blur(var(--glass-smoked-blur)); -webkit-backdrop-filter: blur(var(--glass-smoked-blur)); } .indigo.bl { backdrop-filter: blur(var(--glass-indigo-blur)); -webkit-backdrop-filter: blur(var(--glass-indigo-blur)); }
  }
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) { .gc.bl { background: var(--glass-solid); } }
</style>
