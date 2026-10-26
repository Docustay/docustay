// Docustay 3D library v2 (13 Oct 2026). three.js (MIT). Real WebGL: physical glass, reflections, our own extruded D.
// CREAM (16 Oct 2026, specs/SITE-CREAM-RESTYLE.md §3): the page is light, so depth comes from SHADOW and solid colour, not light. No bloom, no composer, no additive
// blending, no emissive glow, no beams; a transparent canvas over the cream page, ACES tone mapping, a light studio environment, one key light from the top left and a fill,
// a soft violet contact shadow under every object. Motion and timing are unchanged.
// Ported from specs/brand/3d/scenes.js (14 Oct 2026). Loaded lazily by Scene3D.svelte through scene3d-v2.js; never imported by a page directly.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import { dGeometry, D_PATH } from "./dshape.js";
export { dGeometry };
// glass on a light page: transmission kept, thicker, the violet attenuation kept, iridescence only a trace, no emissive; the bright edge comes from edgeLines()
const glass = (c = 0x8d78ff, extra = {}) => new THREE.MeshPhysicalMaterial(Object.assign({
  color: c, metalness: 0, roughness: 0.08, transmission: 1, thickness: 2.0, ior: 1.5, iridescence: 0.08, iridescenceIOR: 1.3,
  iridescenceThicknessRange: [120, 420], clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.25,
  attenuationColor: new THREE.Color(0x5a3ac1), attenuationDistance: 0.9, specularIntensity: 1,
}, extra));
// what used to glow is now a solid satin colour (no emissive); `i` is kept so the call sites read the same
const glow = (c, i = 1) => new THREE.MeshStandardMaterial({ color: new THREE.Color(c), roughness: 0.38, metalness: 0.1, transparent: true, opacity: 1 });
// a crisp edge so a glass shape reads on a light page
function edgeLines(geo, color = 0xffffff, opacity = 0.85, angle = 28) { return new THREE.LineSegments(new THREE.EdgesGeometry(geo, angle), new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false })); }
// the soft violet contact shadow: about 25% at the centre fading to nothing; it lies flat under the object and does not turn with it
function contactShadow(scene, w = 4, y = -2, d = w * 0.5) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128); g.addColorStop(0, 'rgba(60,40,140,0.25)'); g.addColorStop(0.45, 'rgba(60,40,140,0.12)'); g.addColorStop(1, 'rgba(60,40,140,0)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = y; m.renderOrder = -1; scene.add(m); return m;
}

function paperTexture(title, accent = '#5a3ac1') {
  const c = document.createElement('canvas'); c.width = 320; c.height = 420; const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 320, 420);
  x.fillStyle = '#8b89a3'; x.font = '600 15px "JetBrains Mono",monospace'; x.fillText('DOCUMENT', 28, 44);
  x.fillStyle = '#16151f'; x.font = '600 28px Geist,system-ui,sans-serif'; x.fillText(title, 28, 84);
  x.fillStyle = '#dcd8cc';
  [0.92, 0.84, 0.9, 0.68, 0.86, 0.58, 0.8].forEach((w, i) => { x.fillRect(28, 112 + i * 22, 264 * w, 8); });
  x.strokeStyle = accent; x.setLineDash([7, 5]); x.lineWidth = 2; x.strokeRect(28, 318, 126, 44); x.strokeRect(170, 318, 122, 44);
  x.setLineDash([]); x.fillStyle = accent; x.font = '600 13px "JetBrains Mono",monospace'; x.fillText('Provider', 46, 346); x.fillStyle = '#8b89a3'; x.fillText('Client', 196, 346);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function paperMesh(title, w = 1.45, h = 1.9) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, 0.03, 3, 0.02), [
    new THREE.MeshStandardMaterial({ color: 0xe4e1f0, roughness: 0.8 }), new THREE.MeshStandardMaterial({ color: 0xe4e1f0, roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ color: 0xe4e1f0, roughness: 0.8 }), new THREE.MeshStandardMaterial({ color: 0xe4e1f0, roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ map: paperTexture(title), color: 0xffffff, roughness: 0.7, metalness: 0, envMapIntensity: 0.35 }),
    new THREE.MeshStandardMaterial({ color: 0xf7f6fc, roughness: 0.8 })]);
  return m;
}
// the old light dust is now two or three quiet violet specks (normal blending)
function dust(n = 500, spread = [7, 5, 5], color = 0xb9aeff, size = 0.028) {
  n = 3; color = 0x5a3ac1; size = 0.07; spread = [spread[0] * 0.6, spread[1] * 0.6, spread[2] * 0.4];
  const g = new THREE.BufferGeometry(); const p = new Float32Array(n * 3), s = new Float32Array(n);
  for (let i = 0; i < n; i++) { p[i * 3] = (Math.random() - .5) * spread[0]; p[i * 3 + 1] = (Math.random() - .5) * spread[1]; p[i * 3 + 2] = (Math.random() - .5) * spread[2]; s[i] = Math.random(); }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(s, 1));
  const m = new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.35, depthWrite: false, sizeAttenuation: true });
  const pts = new THREE.Points(g, m); pts.userData.dust = true; pts.userData.spread = spread; return pts;
}
function dustUpdate(pts, t) { const a = pts.geometry.attributes.position, sd = pts.geometry.attributes.aSeed, sp = pts.userData.spread; for (let i = 0; i < a.count; i++) { let y = a.getY(i) + 0.0016 + sd.getX(i) * 0.0022; if (y > sp[1] / 2) y = -sp[1] / 2; a.setY(i, y); a.setX(i, a.getX(i) + Math.sin(t * .4 + sd.getX(i) * 20) * 0.0007); } a.needsUpdate = true; }
// a light studio: soft ambient, one key light from the top left, a cool fill from the right (the coloured point lights of the dark site are gone)
function lights(scene, a = 0x6a49e0, b = 0x5ad6ff) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0xe9e5f7, 0.9));
  const k = new THREE.DirectionalLight(0xfff8f0, 1.7); k.position.set(-4, 5, 4); scene.add(k);
  const f = new THREE.DirectionalLight(0xe8ecff, 0.55); f.position.set(4.5, 1, 3); scene.add(f);
}

/* ------------------------------ scenes ------------------------------ */
const SCENES = {
  hero(ctx) { // glass D with orbiting papers and light dust: the home hero
    const { scene } = ctx; lights(scene); const root = new THREE.Group(); scene.add(root);
    const d = new THREE.Mesh(dGeometry(), glass(0xc9bfff, { thickness: 0.9, attenuationDistance: 3.2 })); d.scale.set(1.55, -1.55, 1.55); root.add(d);
    d.add(edgeLines(d.geometry));   // a child, so it follows the D's bob
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.012, 12, 160), glow(0x5a3ac1)); ring.position.z = -0.4; root.add(ring);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.008, 12, 160), glow(0x0b6f7a)); ring2.rotation.x = 1.1; root.add(ring2);
    const papers = []; ['NDA', 'Lease', 'Waiver', 'Agreement', 'Offer'].forEach((t, i) => { const p = paperMesh(t, 0.9, 1.18); p.userData.a = i / 5 * Math.PI * 2; root.add(p); papers.push(p); });
    const pts = dust(700, [9, 6, 6]); scene.add(pts); contactShadow(scene, 5.2, -2.45);
    ctx.fit = new THREE.Box3(new THREE.Vector3(-3.1, -2.6, -1), new THREE.Vector3(3.1, 2.6, 1));
    return (t, m) => { root.rotation.y = Math.sin(t * .35) * .42 + m.x * .35; root.rotation.x = -.06 + m.y * .18; d.position.y = Math.sin(t * .8) * .06;
      ring.rotation.z = t * .25; ring2.rotation.z = -t * .18; papers.forEach((p) => { const a = p.userData.a + t * .32; p.position.set(Math.cos(a) * 2.55, Math.sin(a * 1.3) * .55, Math.sin(a) * 1.5); p.rotation.set(Math.sin(a) * .35, -a + Math.PI / 2, Math.cos(a) * .2); }); dustUpdate(pts, t); };
  },
  D(ctx) {
    const { scene } = ctx; lights(scene); const root = new THREE.Group(); scene.add(root);
    const d = new THREE.Mesh(dGeometry(60), glass(0xc9bfff, { thickness: 1.1, attenuationDistance: 2.6 })); d.scale.set(2, -2, 2); root.add(d);
    d.add(edgeLines(d.geometry));
    // a faint floor reflection instead of the halo: the same D, mirrored under the floor line, very light
    const refl = new THREE.Mesh(d.geometry, new THREE.MeshBasicMaterial({ color: 0x5a3ac1, transparent: true, opacity: 0.07, depthWrite: false })); refl.scale.set(2, 2, 2); refl.position.y = -4.7; root.add(refl);
    const pts = dust(500, [8, 6, 5]); scene.add(pts); contactShadow(scene, 5, -2.5);
    ctx.fit = new THREE.Box3(new THREE.Vector3(-3.2, -2.9, -1), new THREE.Vector3(3.2, 2.9, 1));
    return (t, m) => { root.rotation.y = t * .28 + m.x * .4; root.rotation.x = Math.sin(t * .5) * .12 + m.y * .2; dustUpdate(pts, t); };
  },
  cube(ctx) { // glass cube with a paper and a seal inside
    const { scene } = ctx; lights(scene); const root = new THREE.Group(); scene.add(root);
    const box = new THREE.Mesh(new RoundedBoxGeometry(2.1, 2.1, 2.1, 8, 0.1), glass(0xf3f0fd, { thickness: 2.2, attenuationDistance: 9, roughness: 0.05 })); root.add(box);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2.14, 2.14, 2.14)), new THREE.LineBasicMaterial({ color: 0x5a3ac1, transparent: true, opacity: 0.9 })); root.add(edges);
    const paper = paperMesh('Agreement', 0.95, 1.25); root.add(paper);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 32, 32), glow(0x5a3ac1)); core.position.set(0.5, -0.35, 0.18); root.add(core);
    const pts = dust(380, [7, 5, 5]); scene.add(pts); contactShadow(scene, 4.2, -1.95);
    ctx.fit = new THREE.Box3(new THREE.Vector3(-2, -2, -2), new THREE.Vector3(2, 2, 2));
    return (t, m) => { root.rotation.y = t * .3 + m.x * .5; root.rotation.x = Math.sin(t * .6) * .22 + m.y * .3; paper.position.y = Math.sin(t * 1.1) * .08; paper.rotation.y = Math.sin(t * .7) * .4; core.position.y = -.35 + Math.sin(t * 1.6) * .06; dustUpdate(pts, t); };
  },
  papers(ctx) { // papers drop, stack, get sealed, repeat
    const { scene } = ctx; lights(scene); const root = new THREE.Group(); scene.add(root); const N = 6, items = [];
    const titles = ['Offer', 'Lease', 'Waiver', 'NDA', 'Contract', 'Agreement'];
    for (let i = 0; i < N; i++) { const p = paperMesh(titles[i]); root.add(p); items.push(p); }
    const seal = new THREE.Mesh(dGeometry(30), new THREE.MeshPhysicalMaterial({ color: 0x5a3ac1, metalness: 0.15, roughness: 0.32, clearcoat: 0.6, sheen: 0.4, sheenColor: new THREE.Color(0xc9bdf7) })); seal.scale.set(0.5, -0.5, 0.5); seal.position.set(0.35, -0.55, 0.3); root.add(seal);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.008, 12, 100), glow(0x5a3ac1)); halo.position.copy(seal.position); root.add(halo);
    const pts = dust(300, [6, 5, 4]); scene.add(pts); contactShadow(scene, 3.6, -1.15, 2.2);
    ctx.fit = new THREE.Box3(new THREE.Vector3(-1.9, -1.9, -1), new THREE.Vector3(1.9, 2.3, 1));
    const ease = (x) => 1 - Math.pow(1 - x, 3);
    return (t, m) => { const T = t % 7; root.rotation.y = -.5 + m.x * .35; root.rotation.x = -.1 + m.y * .15;
      items.forEach((p, i) => { const s = i * 0.55, k = Math.min(1, Math.max(0, (T - s) / 0.9)); const e = ease(k); p.visible = T >= s;
        p.position.set(Math.sin(i * 2.1) * .12, 2.4 * (1 - e) + i * .05 - .1, i * .07 - .2); p.rotation.set(-0.05 + (1 - e) * .5, Math.sin(i * 1.7) * .09 * e, Math.sin(i * 3.1) * .05 + (1 - e) * (i % 2 ? .6 : -.6)); });
      const sk = Math.min(1, Math.max(0, (T - 4.1) / 0.5)); seal.visible = halo.visible = T > 4.1; seal.scale.setScalar(.5 * (1.8 - .8 * ease(sk))); halo.scale.setScalar(1 + (T - 4.1) * .5); halo.material.opacity = Math.max(0, 1 - (T - 4.1) * .4); dustUpdate(pts, t); };
  },
  lattice(ctx) { // a data lattice with pulses travelling along its edges
    const { scene } = ctx; lights(scene, 0x6a49e0, 0x5ad6ff); const root = new THREE.Group(); scene.add(root);
    const n = 3, nodes = [], step = 1.15, off = (n - 1) * step / 2; const geo = new THREE.SphereGeometry(0.075, 20, 20);
    for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) for (let z = 0; z < n; z++) { const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x5a3ac1, roughness: .35, metalness: .1 })); m.position.set(x * step - off, y * step - off, z * step - off); root.add(m); nodes.push(m); }
    const lp = []; nodes.forEach((a, i) => nodes.forEach((b, j) => { if (j > i && a.position.distanceTo(b.position) < step * 1.05) { lp.push(a.position.x, a.position.y, a.position.z, b.position.x, b.position.y, b.position.z); } }));
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); root.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x5a3ac1, transparent: true, opacity: .35 })));
    const edgeList = []; for (let i = 0; i < lp.length; i += 6) edgeList.push([new THREE.Vector3(lp[i], lp[i + 1], lp[i + 2]), new THREE.Vector3(lp[i + 3], lp[i + 4], lp[i + 5])]);
    // the travelling pulse is a solid teal bead with a faint ring, not a light streak
    const pulses = []; for (let i = 0; i < 14; i++) { const p = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 16), glow(0x0b6f7a)); p.add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 16), new THREE.MeshBasicMaterial({ color: 0x0b6f7a, transparent: true, opacity: 0.14, depthWrite: false }))); p.userData = { e: edgeList[(i * 7) % edgeList.length], o: Math.random() * 3, s: .5 + Math.random() * .6 }; root.add(p); pulses.push(p); }
    const shell = new THREE.Mesh(new RoundedBoxGeometry(3.6, 3.6, 3.6, 6, 0.1), glass(0xf1eefc, { transmission: 0.9, roughness: 0.2, thickness: .6, transparent: true, opacity: 0.55, depthWrite: false })); root.add(shell);
    const pts = dust(300, [7, 5, 5], 0x5ad6ff); scene.add(pts); contactShadow(scene, 5.4, -2.65);
    ctx.fit = new THREE.Box3(new THREE.Vector3(-2.7, -2.7, -2.7), new THREE.Vector3(2.7, 2.7, 2.7));
    return (t, m) => { root.rotation.y = t * .22 + m.x * .4; root.rotation.x = .35 + Math.sin(t * .4) * .1 + m.y * .2; pulses.forEach((p) => { const k = ((t * p.userData.s + p.userData.o) % 1); p.position.lerpVectors(p.userData.e[0], p.userData.e[1], k); }); dustUpdate(pts, t); };
  },
  seal(ctx) { // sealed medallion: a violet satin disc with an embossed D; the halo is thin ripple rings that fade out
    const { scene } = ctx; lights(scene); const root = new THREE.Group(); scene.add(root);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.35, 0.32, 96, 1), new THREE.MeshPhysicalMaterial({ color: 0x5a3ac1, metalness: 0.15, roughness: 0.34, clearcoat: 0.5, clearcoatRoughness: 0.3, sheen: 0.5, sheenColor: new THREE.Color(0xc9bdf7) })); disc.rotation.x = Math.PI / 2; root.add(disc);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.045, 24, 160), new THREE.MeshPhysicalMaterial({ color: 0xc4beff, metalness: .85, roughness: .2, clearcoat: 1 })); root.add(rim);
    const d = new THREE.Mesh(dGeometry(40), new THREE.MeshPhysicalMaterial({ color: 0xe6e0fb, metalness: .1, roughness: .3, clearcoat: 1 })); d.scale.set(.82, -.82, .82); d.position.z = .22; root.add(d);
    const halos = [0, 1, 2].map((i) => { const h = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.007, 12, 140), glow(0x5a3ac1)); h.material.depthWrite = false; root.add(h); return h; });
    const pts = dust(380, [7, 5, 4]); scene.add(pts); contactShadow(scene, 4, -1.9, 1.6);
    ctx.fit = new THREE.Box3(new THREE.Vector3(-2.5, -2.5, -.6), new THREE.Vector3(2.5, 2.5, .6));
    return (t, m) => { root.rotation.y = Math.sin(t * .5) * .5 + m.x * .5; root.rotation.x = Math.sin(t * .4) * .18 + m.y * .3; halos.forEach((h, i) => { const k = ((t * .35 + i / 3) % 1); h.scale.setScalar(1 + k * .55); h.material.opacity = (1 - k) * .7; }); dustUpdate(pts, t); };
  },
  cards(ctx) { // floating glass cards with fields, refraction and parallax
    const { scene } = ctx; lights(scene); const root = new THREE.Group(); scene.add(root); const cards = [];
    const labels = ['Signature', 'Date', 'Initials', 'Payment · $250', 'Witness'];
    labels.forEach((lb, i) => { const g = new THREE.Group(); const body = new THREE.Mesh(new RoundedBoxGeometry(1.9, 1.1, 0.07, 6, 0.05), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0, clearcoat: 0.3, transmission: 0.1, thickness: 0.2, transparent: true, opacity: 0.92 })); g.add(body);
      const rim = edgeLines(body.geometry, i % 2 ? 0x5a3ac1 : 0x0b6f7a, 0.35, 40); g.add(rim);
      const c = document.createElement('canvas'); c.width = 512; c.height = 300; const x = c.getContext('2d'); x.clearRect(0, 0, 512, 300); x.fillStyle = '#16161d'; x.font = '600 44px Geist,system-ui,sans-serif'; x.fillText(lb, 40, 160); x.strokeStyle = 'rgba(90,58,193,.7)'; x.setLineDash([12, 9]); x.lineWidth = 4; x.strokeRect(24, 90, 464, 110);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; const pl = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.99), new THREE.MeshBasicMaterial({ map: tex, transparent: true })); pl.position.z = .045; g.add(pl);
      g.userData = { i, bx: (i - 2) * 0.55, by: (i % 3 - 1) * 0.95, bz: -i * 0.35 }; root.add(g); cards.push(g); });
    const pts = dust(300, [8, 5, 5]); scene.add(pts); contactShadow(scene, 6.4, -1.9, 2.4);
    ctx.fit = new THREE.Box3(new THREE.Vector3(-3.1, -1.95, -1.6), new THREE.Vector3(3.1, 1.95, 1));
    return (t, m) => { root.rotation.y = m.x * .4 - .15; root.rotation.x = m.y * .25; cards.forEach((g) => { const u = g.userData; g.position.set(u.bx * 1.7, u.by + Math.sin(t * .8 + u.i) * .1, u.bz); g.rotation.set(Math.sin(t * .5 + u.i) * .1, Math.cos(t * .4 + u.i) * .16, Math.sin(t * .3 + u.i) * .05); }); dustUpdate(pts, t); };
  },
  rings(ctx) { // solid violet bands around a satin silver coin, with a teal and a violet bead: payments and automation
    const { scene } = ctx; lights(scene); const root = new THREE.Group(); scene.add(root);
    const band = (c) => new THREE.MeshPhysicalMaterial({ color: c, metalness: .15, roughness: .3, clearcoat: .6 });
    const rs = [1.7, 1.35, 1.0].map((r, i) => { const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.07 - i * .012, 32, 200), band([0x5a3ac1, 0x7a5fd6, 0x9d8cf5][i])); root.add(m); return m; });
    [[0, 0x0b6f7a], [1, 0x5a3ac1]].forEach(([i, c]) => { const b = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 24), band(c)); b.position.set([1.7, 1.35][i], 0, 0); rs[i].add(b); });
    const coin = new THREE.Mesh(new THREE.CylinderGeometry(.62, .62, .12, 80), new THREE.MeshPhysicalMaterial({ color: 0xd9d8e2, metalness: .9, roughness: .32, clearcoat: .5, envMapIntensity: 1.2 })); coin.rotation.x = Math.PI / 2; root.add(coin);
    const d = new THREE.Mesh(dGeometry(20), glow(0x5a3ac1)); d.scale.set(.36, -.36, .36); d.position.z = .1; root.add(d);
    const sparks = dust(400, [6, 5, 5], 0xffffff, 0.022); scene.add(sparks); contactShadow(scene, 4.4, -2.2, 1.8);
    ctx.fit = new THREE.Box3(new THREE.Vector3(-2.4, -2.4, -1), new THREE.Vector3(2.4, 2.4, 1));
    return (t, m) => { root.rotation.x = .25 + m.y * .3; root.rotation.y = m.x * .5; rs[0].rotation.set(t * .35, t * .2, 0); rs[1].rotation.set(-t * .3, t * .4, t * .1); rs[2].rotation.set(t * .5, -t * .25, 0); coin.rotation.z = t * .9; d.rotation.z = 0; dustUpdate(sparks, t); };
  },
  bg(ctx) { // light-weight backdrop for any page: a faint dotted violet floor fading into the same cream (transparent, no glass, no beams)
    const { scene } = ctx; ctx.alpha = true; ctx.noPost = true; scene.fog = new THREE.Fog(0xf7f6fc, 7, 24);
    const pts = dust(260, [14, 8, 8], 0xb9aeff, 0.03); scene.add(pts);
    const fp = []; for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) fp.push(x, 0, z);
    const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    const grid = new THREE.Points(fg, new THREE.PointsMaterial({ color: 0x5a3ac1, size: 0.08, transparent: true, opacity: .55, depthWrite: false, sizeAttenuation: true })); grid.position.y = -3.2; scene.add(grid);
    const beams = [];
    ctx.fit = new THREE.Box3(new THREE.Vector3(-6, -3, -6), new THREE.Vector3(6, 3, 2)); ctx.camPos = [0, 0.5, 9];
    return (t, m) => { grid.position.z = (t * .6) % 1; beams.forEach((b, i) => { b.material.opacity = .04 + .04 * (1 + Math.sin(t * .6 + i)) / 2; }); dustUpdate(pts, t); scene.rotation.y = m.x * .05; };
  },
};

/* ------------------------------ stage ------------------------------ */
export const sceneNames = Object.keys(SCENES);

function fitCamera(ctx, w, h) {
  const cam = ctx.camera; cam.aspect = w / h;
  if (ctx.camPos) { cam.position.set(...ctx.camPos); cam.lookAt(0, 0, 0); cam.updateProjectionMatrix(); return; }
  const size = new THREE.Vector3(); ctx.fit.getSize(size); const c = new THREE.Vector3(); ctx.fit.getCenter(c);
  const vf = THREE.MathUtils.degToRad(cam.fov), hf = 2 * Math.atan(Math.tan(vf / 2) * cam.aspect);
  const dist = Math.max((size.y / 2) / Math.tan(vf / 2), (size.x / 2) / Math.tan(hf / 2)) * 1.12 + size.z / 2;
  cam.position.set(c.x, c.y, c.z + dist); cam.lookAt(c); cam.updateProjectionMatrix();
}

/** Mount one scene in `el`. opts: reduced (draw one still frame), fixedT (render once at that time, for posters), lite (laptop on battery: dpr 1.5). Returns { visible(v), dispose() }. */
export function mountScene(el, name, opts = {}) {
  if (!SCENES[name]) return null;
  const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return null;
  // the 'bg' scene is a transparent canvas; the glass scenes clear to the page's own cream (#f7f6fc), because glass transmission samples what is behind it
  // and an empty (transparent) canvas reads as black through the glass. Same colour as the ground, so there is no edge.
  const transparent = name === 'bg';
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: transparent, powerPreference: 'high-performance' });
  const dpr = Math.min(window.devicePixelRatio || 1, opts.lite ? 1.5 : 2);
  renderer.setPixelRatio(transparent ? 1 : dpr); renderer.setSize(w, h, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0; renderer.outputColorSpace = THREE.SRGBColorSpace;
  if (transparent) renderer.setClearColor(0x000000, 0);
  const cv = renderer.domElement; cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'; cv.setAttribute('aria-hidden', 'true'); el.appendChild(cv);
  const scene = new THREE.Scene(); if (!transparent) scene.background = new THREE.Color(0xf7f6fc);
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(32, w / h, 0.1, 100); const ctx = { scene, camera }; const update = SCENES[name](ctx); fitCamera(ctx, w, h);
  const composer = null;   // no post-processing on the light page (the bloom composer is gone)
  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  const onMove = (e) => { const r = el.getBoundingClientRect(); mouse.tx = ((e.clientX - r.left) / r.width - .5) * 2; mouse.ty = ((e.clientY - r.top) / r.height - .5) * 2; };
  const draw = () => (composer ? composer.render() : renderer.render(scene, camera));
  let raf = 0, alive = true, shown = true; const clock = new THREE.Clock();
  const frame = () => { if (!alive) return; if (!shown) { raf = 0; return; } raf = requestAnimationFrame(frame); const t = clock.getElapsedTime(); mouse.x += (mouse.tx - mouse.x) * .05; mouse.y += (mouse.ty - mouse.y) * .05; update(t, mouse); draw(); };
  if (opts.fixedT != null || opts.reduced) { update(opts.fixedT ?? 2.2, mouse); draw(); } else { window.addEventListener('pointermove', onMove, { passive: true }); frame(); }
  const ro = new ResizeObserver(() => { const nw = el.clientWidth, nh = el.clientHeight; if (!nw || !nh) return; renderer.setSize(nw, nh, false); composer && composer.setSize(nw, nh); fitCamera(ctx, nw, nh); if (opts.fixedT != null || opts.reduced) { update(opts.fixedT ?? 2.2, mouse); draw(); } }); ro.observe(el);
  return {
    visible(v) { shown = v; if (v && !raf && alive && opts.fixedT == null && !opts.reduced) frame(); },
    dispose() { alive = false; cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener('pointermove', onMove); pm.dispose(); scene.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => { x.map?.dispose?.(); x.dispose?.(); }); }); composer?.dispose?.(); renderer.dispose(); renderer.forceContextLoss(); cv.remove(); },
  };
}
