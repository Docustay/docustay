<script>
  // The area chart (report §17.4), hand-built on d3-shape and d3-scale (ISC). Chosen over LayerChart because LayerChart's dependency tree pulls @sveltejs/kit and vite (and lightningcss, MPL-2.0) into the production licence graph.
  // Motion: the line draws left to right over 900 ms, the fill fades in over 600 ms; a crosshair, a dot and a tooltip follow the pointer. Reduced motion shows the finished chart.
  // data: [{ date, <series keys> }]; series: [{ key, label, color }]
  import { area, line, curveMonotoneX } from "d3-shape";
  import { whenText } from "$lib/i18n/index.svelte.js";
  import { scaleTime, scaleLinear } from "d3-scale";
  let { data = [], series = [{ key: "value", label: "Value", color: "var(--brand)" }], height = 240, label = "", format = (v) => String(v) } = $props();
  let width = $state(640), box = $state(null), hover = $state(null);
  const M = { t: 12, r: 34, b: 24, l: 8 };
  const rows = $derived(data.map((d) => ({ ...d, date: d.date instanceof Date ? d.date : new Date(d.date) })).sort((a, b) => a.date - b.date));
  const x = $derived(scaleTime().domain([rows[0]?.date ?? new Date(), rows.at(-1)?.date ?? new Date()]).range([M.l, width - M.r]));
  const top = $derived(Math.max(1, ...rows.flatMap((r) => series.map((s) => Number(r[s.key]) || 0))));
  const y = $derived(scaleLinear().domain([0, top]).nice().range([height - M.b, M.t]));
  const paths = $derived(series.map((s) => ({ s, area: area().curve(curveMonotoneX).x((r) => x(r.date)).y0(y(0)).y1((r) => y(Number(r[s.key]) || 0))(rows), line: line().curve(curveMonotoneX).x((r) => x(r.date)).y((r) => y(Number(r[s.key]) || 0))(rows) })));
  const yTicks = $derived([...new Set(y.ticks(4).filter((v) => Number.isInteger(v)))]), xTicks = $derived(x.ticks(Math.max(2, Math.floor(width / 110))));
  const fmtDate = (d) => whenText(d, { month: "short", day: "numeric" });
  function move(e) {
    if (!rows.length || !box) return;
    const px = e.clientX - box.getBoundingClientRect().left, t = x.invert(px);
    let best = 0, bd = Infinity; rows.forEach((r, i) => { const d = Math.abs(r.date - t); if (d < bd) { bd = d; best = i; } });
    hover = best;
  }
  const h = $derived(hover === null ? null : rows[hover]);
</script>
<div bind:this={box} bind:clientWidth={width} class="relative w-full select-none" style="height:{height}px" role="img" aria-label={label || undefined} data-testid="area-chart" onpointermove={move} onpointerleave={() => (hover = null)}>
  <svg {width} {height} viewBox="0 0 {width} {height}" class="block overflow-visible">
    {#each yTicks as t (t)}<g><line x1={M.l} x2={width - M.r} y1={y(t)} y2={y(t)} stroke="var(--line-strong)" stroke-dasharray="1 5" stroke-linecap="round" /><text x={width - M.r + 8} y={y(t)} dy=".32em" text-anchor="start" class="fill-[var(--faint)] font-mono text-[10px]">{format(t)}</text></g>{/each}
    {#each xTicks as t (+t)}<text x={x(t)} y={height - 6} text-anchor="middle" class="fill-[var(--faint)] font-mono text-[10px]">{fmtDate(t)}</text>{/each}
    {#each paths as p (p.s.key)}<path d={p.area} fill={p.s.color} fill-opacity=".14" class="fill-in" /><path d={p.line} fill="none" stroke={p.s.color} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" pathLength="1" class="draw" />{/each}
    {#if rows.length}{@const lr = rows.at(-1)}{#each series as s (s.key)}<circle cx={x(lr.date)} cy={y(Number(lr[s.key]) || 0)} r="4" fill={s.color} class="pinger" style="transform-box: fill-box; transform-origin: center" /><circle cx={x(lr.date)} cy={y(Number(lr[s.key]) || 0)} r="3" fill={s.color} />{/each}{/if}
    {#if h}<line x1={x(h.date)} x2={x(h.date)} y1={M.t} y2={height - M.b} stroke="var(--line-strong)" stroke-dasharray="3 3" />{#each series as s (s.key)}<circle cx={x(h.date)} cy={y(Number(h[s.key]) || 0)} r="4" fill="var(--card)" stroke={s.color} stroke-width="2" />{/each}{/if}
  </svg>
  {#if h}<div class="pointer-events-none absolute z-10 rounded-lg border border-line-strong bg-panel px-2.5 py-1.5 text-xs shadow-[var(--shadow)]" style="left:{Math.min(width - 130, Math.max(0, x(h.date) + 10))}px;top:8px;transition:left 90ms var(--ease-out)"><div class="font-mono text-faint">{fmtDate(h.date)}</div>{#each series as s (s.key)}<div class="flex items-center gap-1.5"><i class="h-2 w-2 rounded-full" style="background:{s.color}"></i>{s.label}<b class="ml-auto pl-3 tabular-nums">{format(Number(h[s.key]) || 0)}</b></div>{/each}</div>{/if}
</div>
