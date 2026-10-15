<script>
  // A heading whose words appear one after another as it scrolls into view. The words are real text in the server's HTML (so it reads, searches and prints without script);
  // the effect only flips a data attribute. Tag and class are passed through. Tested: specs/svelte-playbook-recipes (word reveal).
  import { shown } from "./index.js";
  let { text, tag = "h2", class: cls = "" } = $props();
  const parts = $derived(text.split(/\s+/));
</script>
<svelte:element this={tag} class={cls} data-words aria-label={text} {@attach shown(0.4)}>{#each parts as w, i}<span class="w" style="--i:{i}" aria-hidden="true">{w}</span>{" "}{/each}</svelte:element>
