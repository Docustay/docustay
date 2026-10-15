<script>
  import TemplatePage from "$lib/site/desk/TemplatePage.svelte";
  let { data } = $props();
</script>
<TemplatePage t={data.t} m={data.m} use={data.use} related={data.related} />
