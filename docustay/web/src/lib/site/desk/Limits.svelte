<script>let { items } = $props();</script>
<div class="d-limits" role="list">{#each items as [k, v]}<div role="listitem"><b>{k}</b><span>{v}</span></div>{/each}</div>
