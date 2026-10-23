<script>import { plain } from "./feat.js";
  let { items } = $props();</script>
<div class="d-limits" role="list">{#each items as [k, v]}<div role="listitem"><b>{plain(k)}</b><span>{plain(v)}</span></div>{/each}</div>
