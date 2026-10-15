<script>let { rows } = $props();</script>
<div class="d-spec">{#each rows as [k, v]}<div><b>{k}</b><span>{@html v}</span></div>{/each}</div>
