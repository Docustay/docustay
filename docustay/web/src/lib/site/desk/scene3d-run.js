// The three.js scenes behind Scene3D.svelte. Loaded only when a scene is near the screen. No textures from files: every picture is drawn on a small canvas.
import * as THREE from "three";
const PAPER = 0xfaf8f3, RED = 0x5a3ac1, INK = "#1b1b1b";
const tex = (w, h, draw) => { const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d"); draw(g, w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.needsUpdate = true; return { t, c, g }; };
const lines = (g, w, h, n = 9, from = 0.3) => { g.fillStyle = "#faf8f3"; g.fillRect(0, 0, w, h); g.fillStyle = "#d9d5ca"; for (let i = 0; i < n; i++) g.fillRect(w * 0.1, h * (from + i * 0.065), w * (i % 3 === 2 ? 0.55 : 0.8), h * 0.018); g.fillStyle = INK; g.fillRect(w * 0.1, h * 0.1, w * 0.5, h * 0.03); };
const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const seg = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));

function sceneStack(scene) {
  const g = new THREE.Group(); scene.add(g); const sheets = [];
  const geo = new THREE.BoxGeometry(2.1, 2.9, 0.025);
  for (let i = 0; i < 5; i++) { const { t } = tex(256, 360, (c, w, h) => lines(c, w, h)); const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: t })); g.add(m); sheets.push(m); }
  const sig = tex(512, 160, (c, w, h) => c.clearRect(0, 0, w, h)); const sigMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.375), new THREE.MeshBasicMaterial({ map: sig.t, transparent: true })); sigMesh.position.set(-0.2, -0.95, 0.02); sheets[4].add(sigMesh);
  const box = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.4), new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.12 })); box.position.set(-0.2, -0.95, 0.016); sheets[4].add(box);
  const stampT = tex(256, 256, (c, w, h) => { c.clearRect(0, 0, w, h); c.strokeStyle = "#5a3ac1"; c.lineWidth = 12; c.beginPath(); c.arc(w / 2, h / 2, 108, 0, 7); c.stroke(); c.lineWidth = 4; c.beginPath(); c.arc(w / 2, h / 2, 90, 0, 7); c.stroke(); c.fillStyle = "#5a3ac1"; c.font = "800 44px sans-serif"; c.textAlign = "center"; c.fillText("SIGNED", w / 2, h / 2 + 15); });
  const stamp = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: stampT.t, transparent: true })); stamp.rotation.z = -0.25; stamp.position.set(0.45, -0.55, 0.3); sheets[4].add(stamp);
  const strokes = [[0, 0.7], [0.12, 0.3], [0.2, 0.85], [0.28, 0.35], [0.36, 0.75], [0.46, 0.45], [0.58, 0.7], [0.7, 0.4], [0.82, 0.62]];
  const drawSig = (p) => { const c = sig.g, w = 512, h = 160; c.clearRect(0, 0, w, h); c.strokeStyle = INK; c.lineWidth = 7; c.lineCap = "round"; c.lineJoin = "round"; c.beginPath(); const n = Math.max(1, Math.floor(strokes.length * p)); for (let i = 0; i < n; i++) { const [x, y] = strokes[i]; const px = 30 + x * 440, py = 20 + y * 110; i ? c.lineTo(px, py) : c.moveTo(px, py); } c.stroke(); sig.t.needsUpdate = true; };
  return { update(t, still) {
    const T = still ? 8.4 : t % 10; const fan = ease(seg(T, 0, 1.6)), ink = seg(T, 2, 5.2), drop = seg(T, 5.6, 6.3), hold = seg(T, 9.2, 10);
    sheets.forEach((s, i) => { const k = 4 - i; s.position.set((-0.18 * k) * fan * (1 - hold), 0.05 * k * fan, -0.12 * k); s.rotation.z = 0.035 * k * fan * (1 - hold); });
    if (still || T > 5.2 || T < 2.1) drawSig(still ? 1 : T > 5.2 ? 1 : 0); else drawSig(ink);
    stamp.visible = drop > 0 && hold < 1; const fall = 1 - ease(drop); stamp.position.z = 0.3 + fall * 1.6; stamp.material.opacity = Math.min(1, drop * 3) * (1 - hold); stamp.scale.setScalar(1 + fall * 0.6);
    g.rotation.y = still ? -0.35 : Math.sin(t * 0.35) * 0.4 - 0.2; g.rotation.x = -0.12; } };
}
function sceneRoute(scene) {
  const g = new THREE.Group(); scene.add(g); const pts = [new THREE.Vector3(-3, -0.6, 0), new THREE.Vector3(0, 0.9, 0), new THREE.Vector3(3, -0.6, 0)];
  const curve = new THREE.CatmullRomCurve3(pts); const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(60)), new THREE.LineDashedMaterial({ color: 0x4c4a5e, dashSize: 0.12, gapSize: 0.1, transparent: true, opacity: 0.5 })); line.computeLineDistances(); g.add(line);
  const nodes = pts.map((p, i) => { const n = new THREE.Group(); n.position.copy(p); const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.025, 12, 48), new THREE.MeshBasicMaterial({ color: 0x4c4a5e })); const dot = new THREE.Mesh(new THREE.CircleGeometry(0.34, 40), new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0 })); const lbl = tex(128, 128, (c, w, h) => { c.fillStyle = "#16161d"; c.font = "700 70px sans-serif"; c.textAlign = "center"; c.fillText(String(i + 1), w / 2, h / 2 + 24); }); const num = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ map: lbl.t, transparent: true })); n.add(ring, dot, num); g.add(n); return { ring, dot, num }; });
  const { t: pt } = tex(128, 180, (c, w, h) => lines(c, w, h, 6, 0.35)); const env = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.86, 0.03), new THREE.MeshBasicMaterial({ map: pt })); g.add(env);
  return { update(t, still) {
    const T = still ? 9 : t % 9; const u = seg(T, 0.4, 7.4); const p = still ? 1 : u; const pos = curve.getPoint(Math.min(0.999, p)); env.position.copy(pos); env.position.z = 0.1; env.rotation.z = Math.sin(p * 6) * 0.12;
    nodes.forEach((n, i) => { const done = p >= (i + 0.5) / 3 - 0.04 || still; n.dot.material.opacity = done ? 0.9 : 0; n.ring.material.color.setHex(done ? RED : 0x4c4a5e); n.num.visible = !done; });
    g.rotation.y = still ? 0 : Math.sin(t * 0.3) * 0.25; g.rotation.x = -0.08; } };
}
function sceneChain(scene) {
  const g = new THREE.Group(); scene.add(g); const blocks = [];
  for (let i = 0; i < 5; i++) { const lab = (hex) => tex(256, 256, (c, w, h) => { c.fillStyle = "#ffffff"; c.fillRect(0, 0, w, h); c.fillStyle = hex; c.font = "600 34px monospace"; c.textAlign = "center"; c.fillText("#" + (i + 1), w / 2, 70); c.font = "500 30px monospace"; const s = "9f2c41ab"; c.fillText(hex === "#5a3ac1" ? "changed" : s.slice(0, 4) + "…", w / 2, h / 2 + 30); c.strokeStyle = hex; c.lineWidth = 8; c.strokeRect(6, 6, w - 12, h - 12); }); const a = lab("#16161d"), b = lab("#5a3ac1"); const m = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.05, 0.3), new THREE.MeshBasicMaterial({ map: a.t })); m.position.x = (i - 2) * 1.6; g.add(m); blocks.push({ m, a: a.t, b: b.t }); if (i) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: 0x4c4a5e })); l.position.x = (i - 2) * 1.6 - 0.8; g.add(l); } }
  return { update(t, still) { const T = still ? 5 : t % 8; const bad = T > 2; blocks.forEach((bk, i) => { const hit = still ? i >= 1 : bad && T > 2 + i * 0.5 && i >= 1; bk.m.material.map = hit ? bk.b : bk.a; bk.m.rotation.y = hit && !still ? Math.min(Math.PI * 2, (T - 2 - i * 0.5) * 6) % (Math.PI * 2) : 0; });
    g.rotation.y = still ? -0.3 : Math.sin(t * 0.4) * 0.35; g.rotation.x = -0.15; } };
}
// demo: the /demo page's scene (the Run 9 board look): a violet grid floor gliding toward you, a stack of paper floating above it, and product screens rising in from the depth, one after another.
function sceneDemo(scene) {
  scene.fog = new THREE.Fog(0xf7f6fc, 10, 24);
  const floor = new THREE.Group(); scene.add(floor); const CELL = 1, N = 22, HALF = 11;
  const lm = new THREE.LineBasicMaterial({ color: 0x5a3ac1, transparent: true, opacity: 0.35 });
  const pts = []; for (let i = -HALF; i <= HALF; i++) { pts.push(i * CELL, 0, -N * CELL, i * CELL, 0, 2); }   // lines running away from the camera
  const geoV = new THREE.BufferGeometry(); geoV.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3)); floor.add(new THREE.LineSegments(geoV, lm));
  const cross = []; for (let k = 0; k < N + 3; k++) cross.push(-HALF, 0, -k * CELL, HALF, 0, -k * CELL);
  const geoH = new THREE.BufferGeometry(); geoH.setAttribute("position", new THREE.Float32BufferAttribute(cross, 3)); const rows = new THREE.LineSegments(geoH, lm); floor.add(rows);
  floor.position.y = -1.55;
  const stack = new THREE.Group(); scene.add(stack); const sheets = []; const geo = new THREE.BoxGeometry(1.9, 2.6, 0.022);
  for (let i = 0; i < 4; i++) { const { t } = tex(256, 360, (c, w, h) => lines(c, w, h)); const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: t })); stack.add(m); sheets.push(m); }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.02, 10, 48), new THREE.MeshBasicMaterial({ color: RED })); ring.position.set(0.45, -0.7, 0.3); sheets[3].add(ring);
  const screen = (title, accent) => tex(512, 320, (c, w, h) => { c.fillStyle = "#ffffff"; c.fillRect(0, 0, w, h); c.fillStyle = "#faf9fe"; c.fillRect(0, 0, w, 44); c.fillStyle = "#e4e1f0"; for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(24 + i * 22, 22, 6, 0, 7); c.fill(); }
    c.fillStyle = "#16161d"; c.font = "600 24px sans-serif"; c.fillText(title, 28, 84); for (let i = 0; i < 4; i++) { c.fillStyle = "#e4e1f0"; c.fillRect(28, 108 + i * 46, w - 56, 34); c.fillStyle = i === 1 ? accent : "#d9d5ea"; c.fillRect(40, 120 + i * 46, 110 + i * 24, 10); c.fillStyle = "#ece9f6"; c.fillRect(w - 120, 120 + i * 46, 80, 10); } });
  const defs = [["Documents", "#5a3ac1", -2.15, -0.8], ["Sign", "#5a3ac1", 2.15, -1.3], ["Scribe", "#5a3ac1", 0.3, -4.2]];
  const panels = defs.map(([title, accent, x, z], i) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 1.69), new THREE.MeshBasicMaterial({ map: screen(title, accent).t, transparent: true })); m.position.set(x, -3, z); m.rotation.y = x < -1 ? 0.5 : x > 1 ? -0.5 : 0; scene.add(m); return { m, x, z, i }; });
  return { update(t, still) {
    const T = still ? 99 : t;
    floor.children[1].position.z = (T * 0.55) % CELL;   // the cross lines glide toward the viewer; the long lines are static
    const bob = still ? 0 : Math.sin(t * 0.9) * 0.08;
    sheets.forEach((s, i) => { const k = 3 - i; s.position.set(-0.14 * k, 0.04 * k + bob, -0.1 * k); s.rotation.z = 0.04 * k; });
    stack.rotation.y = still ? -0.3 : Math.sin(t * 0.32) * 0.28 - 0.12; stack.rotation.x = -0.1; stack.position.y = 0.15;
    panels.forEach(({ m, i }) => { const u = still ? 1 : ease(seg(T - i * 0.9, 0.4, 2.4)); m.position.y = -2.4 + u * 3.15 + (still ? 0 : Math.sin(t * 0.7 + i) * 0.05); m.material.opacity = u; });
  } };
}
const KINDS = { stack: sceneStack, route: sceneRoute, chain: sceneChain, demo: sceneDemo };
export async function run(host, kind, { reduced = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; host.appendChild(renderer.domElement);
  const scene = new THREE.Scene(); scene.add(new THREE.AmbientLight(0xffffff, 1.6)); const sun = new THREE.DirectionalLight(0xffffff, 1.1); sun.position.set(2, 3, 5); scene.add(sun);
  const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 50); cam.position.set(0, kind === "demo" ? 0.9 : 0, kind === "stack" ? 6.6 : kind === "route" ? 10.5 : kind === "demo" ? 8.4 : 9.5); if (kind === "demo") cam.lookAt(0, 0.1, 0);
  const S = KINDS[kind](scene); let visible = true, raf = 0, t0 = performance.now();
  const size = () => { const w = host.clientWidth || 600, h = host.clientHeight || 360; renderer.setSize(w, h, false); cam.aspect = w / h; if (kind === "route" || kind === "chain") { const z0 = kind === "route" ? 10.5 : 9.5; cam.position.z = z0 * 0.86 * Math.max(1, 1.67 / cam.aspect); } cam.updateProjectionMatrix(); };
  size(); const ro = new ResizeObserver(() => { size(); renderer.render(scene, cam); }); ro.observe(host);
  const frame = () => { if (!visible) { raf = 0; return; } S.update((performance.now() - t0) / 1000, false); renderer.render(scene, cam); raf = requestAnimationFrame(frame); };
  if (reduced) { S.update(0, true); renderer.render(scene, cam); } else raf = requestAnimationFrame(frame);
  return { visible(v) { visible = v; if (v && !reduced && !raf) raf = requestAnimationFrame(frame); }, dispose() { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); renderer.domElement.remove(); scene.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => { x.map?.dispose?.(); x.dispose?.(); }); }); } };
}
