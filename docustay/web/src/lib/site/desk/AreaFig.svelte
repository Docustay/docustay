<script>
  import { whenVisible } from "./reveal.js";
  // An area chart in the Desk hand: warm-white line and fill on the grid, the LAST point in red and pinging. Sample data is labelled by the figure caption.
  // Hand-written monotone curve (the same Fritsch-Carlson steps d3's curveMonotoneX uses) so the home page ships no chart library.
  let { points, height = 220 } = $props();
  const W = 640;
  const x = $derived((i) => 14 + (i * (W - 28)) / (points.length - 1));
  const y = $derived((v) => height - 14 - (v / (Math.max(...points) * 1.15)) * (height - 28));
  const curve = $derived.by(() => {
    const n = points.length, px = points.map((_, i) => x(i)), py = points.map((v) => y(v));
    const h = [], s = [], m = new Array(n).fill(0);
    for (let i = 0; i < n - 1; i++) { h[i] = px[i + 1] - px[i]; s[i] = (py[i + 1] - py[i]) / h[i]; }
    for (let i = 1; i < n - 1; i++) { m[i] = s[i - 1] * s[i] <= 0 ? 0 : (2 * s[i - 1] * s[i]) / (s[i - 1] + s[i]); }
    m[0] = s[0]; m[n - 1] = s[n - 2];
    for (let i = 0; i < n - 1; i++) { if (s[i] === 0) { m[i] = 0; m[i + 1] = 0; } else { const a = m[i] / s[i], b = m[i + 1] / s[i], t = a * a + b * b; if (t > 9) { const k = 3 / Math.sqrt(t); m[i] = k * a * s[i]; m[i + 1] = k * b * s[i]; } } }
    let d = `M${px[0]},${py[0]}`;
    for (let i = 0; i < n - 1; i++) d += `C${px[i] + h[i] / 3},${py[i] + (m[i] * h[i]) / 3},${px[i + 1] - h[i] / 3},${py[i + 1] - (m[i + 1] * h[i]) / 3},${px[i + 1]},${py[i + 1]}`;
    return d;
  });
  const d = $derived(curve);
  const a = $derived(`${curve}L${x(points.length - 1)},${height - 14}L${x(0)},${height - 14}Z`);
  let on = $state(false);
</script>
<svg viewBox="0 0 {W} {height}" class="w-full" role="img" aria-label="Documents signed per day, sample data" {@attach whenVisible((v) => v && (on = true))}>
  <path d={a} fill="rgb(244 242 236 / .08)" style="opacity:{on ? 1 : 0};transition:opacity .8s .9s" />
  <path {d} fill="none" stroke="rgb(244 242 236 / .85)" stroke-width="1.6" pathLength="1" style="stroke-dasharray:1;stroke-dashoffset:{on ? 0 : 1};transition:stroke-dashoffset 1.8s ease-out" />
  <circle cx={x(points.length - 1)} cy={y(points.at(-1))} r="4.5" fill="#8585fd" /><circle cx={x(points.length - 1)} cy={y(points.at(-1))} r="4.5" fill="none" stroke="#8585fd" class="ping" />
</svg>
<style>.ping { transform-box: fill-box; transform-origin: center; animation: ping 1.8s ease-out infinite; } @keyframes ping { 0% { transform: scale(1); opacity: .9; } 100% { transform: scale(2.6); opacity: 0; } }</style>
