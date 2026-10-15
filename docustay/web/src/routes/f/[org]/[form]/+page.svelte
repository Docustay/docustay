<script>
  import { page } from "$app/state";
  import PublicForm from "$lib/forms/PublicForm.svelte";
</script>
<PublicForm org={page.params.org} slug={page.params.form} />
