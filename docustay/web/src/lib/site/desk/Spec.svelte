<script>import { plain } from "./feat.js";
  let { rows } = $props();</script>
<div class="d-spec">{#each rows as [k, v]}<div><b>{k}</b><span>{@html plain(v)}</span></div>{/each}</div>
