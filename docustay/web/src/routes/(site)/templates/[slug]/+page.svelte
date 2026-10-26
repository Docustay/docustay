<script>
  import TemplatePage from "$lib/site/desk/TemplatePage.svelte";
  import FormTemplatePage from "$lib/site/desk/FormTemplatePage.svelte";
  let { data } = $props();
</script>
{#if data.f}<FormTemplatePage f={data.f} cat={data.cat} related={data.related} />{:else}<TemplatePage t={data.t} m={data.m} use={data.use} related={data.related} />{/if}
