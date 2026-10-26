<script>
  // Brand and language logos from simple-icons (CC0), only the ones listed here, so unused logos never ship. Use them only to name a real integration.
  import { siGithub, siStripe, siDocker, siNodedotjs, siPython, siGo, siPhp, siRuby, siOpenjdk, siDotnet, siRailway, siSvelte, siTypescript, siZapier, siN8n } from "simple-icons";
  const L = { github: siGithub, stripe: siStripe, docker: siDocker, node: siNodedotjs, python: siPython, go: siGo, php: siPhp, ruby: siRuby, java: siOpenjdk, dotnet: siDotnet, railway: siRailway, svelte: siSvelte, typescript: siTypescript, zapier: siZapier, n8n: siN8n };
  let { name, size = 20, label = "" } = $props();
  const icon = $derived(L[name]);
</script>
{#if icon}<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" role="img" aria-label={label || icon.title}><path d={icon.path} /></svg>{/if}
