<script>
  import { land } from "./reveal.js";
  let { text = "SIGNED", style = "" } = $props();
</script>
<span class="stamp" {style} {@attach land}>{text}</span>
