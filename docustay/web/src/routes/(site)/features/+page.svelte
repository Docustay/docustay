<script>
  import PageView from "$lib/site/desk/PageView.svelte";
  let { data } = $props();
</script>
<PageView page={data.page} templates={data.templates ?? []} />
