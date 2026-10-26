// The one live object of the public site (V3): the Docustay D, polished violet (cream page, 16 Oct 2026), turning very slowly on the page background. No bloom, no dust, no grid, no papers, no frame, a transparent canvas.
// Sway of about 0.35 rad over 14 s; it never moves faster. Paused off screen (the caller's IntersectionObserver calls visible(false)). Loaded lazily; phones and reduced motion keep the still image instead.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { brandD } from "./objects.js";
export function mountD(host) {
  const R = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  R.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); R.setClearColor(0x000000, 0); R.outputColorSpace = THREE.SRGBColorSpace; R.toneMapping = THREE.ACESFilmicToneMapping;
  host.appendChild(R.domElement);
  const scene = new THREE.Scene(); const pm = new THREE.PMREMGenerator(R); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.6;
  const key = new THREE.DirectionalLight(0xfff6ee, 2.2); key.position.set(-3, 5, 4); const fill = new THREE.DirectionalLight(0xdfe8ff, 0.6); fill.position.set(4, 2, 3); scene.add(key, fill);
  const obj = brandD(); scene.add(obj); obj.position.y = -1.0;
  const cam = new THREE.PerspectiveCamera(24, 1, 0.1, 50); cam.position.set(0, 0.1, 7.2); cam.lookAt(0, 0, 0);
  const size = () => { const w = host.clientWidth || 300, h = host.clientHeight || 300; R.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
  size(); const ro = new ResizeObserver(size); ro.observe(host);
  let on = true, raf = 0; const t0 = performance.now();
  const frame = (now) => { raf = 0; if (!on) return; const t = (now - t0) / 1000; obj.rotation.y = -0.5 + Math.sin(t * (Math.PI * 2 / 14)) * 0.35; R.render(scene, cam); raf = requestAnimationFrame(frame); };
  raf = requestAnimationFrame(frame);
  return { visible: (v) => { on = v; if (v && !raf) raf = requestAnimationFrame(frame); }, dispose: () => { on = false; cancelAnimationFrame(raf); ro.disconnect(); R.dispose(); R.domElement.remove(); } };
}
