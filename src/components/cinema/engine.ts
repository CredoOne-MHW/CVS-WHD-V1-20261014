/**
 * Cinematic login scene (Three.js, WebGL). Loaded on demand — never part of the app bundle.
 *
 * Story, cycling every few seconds:  01 Leads stream in from every source → 02 Clients orbit, managed end to end →
 * 03 AI intelligence pulses through a neural sphere. The logo floats in the middle on a glass tile with rings of light
 * (the "aura") circling it. Colours come from the brand's CSS variables, so every company's scene is its own.
 *
 * Performance: one draw call per layer (points / instanced meshes / shaders), DPR capped, rendering pauses when the
 * tab is hidden or the panel is off-screen, and a single still frame is drawn for prefers-reduced-motion.
 */
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

export type CinemaOptions = { logoUrl?: string; name: string; onPhase?: (i: number) => void; phaseSeconds?: number };

const cssColor = (el: Element, v: string, fallback: string) => {
  const raw = getComputedStyle(el).getPropertyValue(v).trim(); // "r g b"
  const p = raw.split(/\s+/).map(Number);
  return p.length === 3 && p.every((n) => !isNaN(n)) ? new THREE.Color(p[0] / 255, p[1] / 255, p[2] / 255) : new THREE.Color(fallback);
};
const initials = (s: string) =>
  s
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "•";

function radialTexture(inner: string, outer: string, size = 256) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}


const SOFT_POINT_FRAG = /* glsl */ `
  varying vec3 vColor; varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor * (1.0 + a), a * vAlpha);
  }`;

export function start(el: HTMLElement, opts: CinemaOptions) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const brand300 = cssColor(el, "--brand-300", "#a5a8ff");
  const brand500 = cssColor(el, "--brand-500", "#5b5fc7");
  const brand700 = cssColor(el, "--brand-700", "#2f3180");
  const brand950 = cssColor(el, "--brand-950", "#111233");
  const accent = cssColor(el, "--accent-300", "#f2d27a");
  const hex = (c: THREE.Color) => `#${c.getHexString()}`;
  const brand800lite = () => brand700.clone().lerp(brand950, 0.55);

  /* ── renderer / scene / camera ── */
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping; // logo and tile keep their exact colours
  const canvas = renderer.domElement;
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
  canvas.setAttribute("aria-hidden", "true");
  el.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = radialTexture(hex(brand800lite()), hex(brand950.clone().multiplyScalar(0.45)), 512);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0, 17);

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(-4, 6, 8);
  scene.add(key);
  const rim = new THREE.PointLight(brand300, 30, 20);
  rim.position.set(3, -2, -3);
  scene.add(rim);

  const world = new THREE.Group();
  world.position.y = 1.55; // leave room for the headline below
  scene.add(world);
  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);

  /* ── 0. the sun: a glowing sphere with the logo on its face, centre of the system ── */
  const tile = new THREE.Group(); // the sun group (floats and follows the pointer)
  world.add(tile);
  const SUN_R = 1.55;
  const TW = SUN_R * 1.8; // lead streams land around the sun's rim
  const TH = SUN_R * 1.7;
  const sunUniforms = {
    uLogo: { value: null as THREE.Texture | null },
    uHasLogo: { value: 0 },
    uLogoSize: { value: new THREE.Vector2(0.6, 0.35) },
    uCore: { value: new THREE.Color(0.86, 0.87, 0.91) },
    uEdge: { value: brand300.clone().lerp(new THREE.Color(1, 1, 1), 0.15).multiplyScalar(0.8) },
    uRim: { value: brand300.clone().lerp(accent, 0.25) },
    uTime: { value: 0 },
  };
  const sunMat = track(
    new THREE.ShaderMaterial({
      uniforms: sunUniforms,
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vPos;
        void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vPos = mv.xyz; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uLogo; uniform float uHasLogo; uniform vec2 uLogoSize;
        uniform vec3 uCore; uniform vec3 uEdge; uniform vec3 uRim; uniform float uTime;
        varying vec3 vN; varying vec3 vPos;
        void main(){
          vec3 n = normalize(vN);
          vec3 v = normalize(-vPos);
          float ndv = clamp(dot(n, v), 0.0, 1.0);
          // pearl body: bright core, brand-tinted limb, soft key light from the top-left
          vec3 col = mix(uEdge, uCore, smoothstep(0.0, 0.55, ndv));
          float l = clamp(dot(n, normalize(vec3(-0.45, 0.6, 0.7))), 0.0, 1.0);
          col *= 0.84 + 0.18 * l;
          // slow shimmer near the limb (the sun's surface)
          float sh = sin(n.x * 9.0 + uTime * 0.7) * sin(n.y * 7.0 - uTime * 0.5);
          col += uEdge * 0.05 * sh * (1.0 - ndv);
          // the logo, printed on the face: always faces the viewer and follows the curvature (never cropped)
          vec2 uv = n.xy / uLogoSize * 0.5 + 0.5;
          if (uHasLogo > 0.5 && n.z > 0.0 && uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
            vec4 lg = texture2D(uLogo, uv);
            col = mix(col, lg.rgb, lg.a);
          }
          // corona at the rim (this part glows)
          float fres = pow(1.0 - ndv, 4.0);
          col += uRim * fres * 1.5;
          gl_FragColor = vec4(col, 1.0);
        }`,
    })
  );
  const sun = new THREE.Mesh(track(new THREE.SphereGeometry(SUN_R, 96, 96)), sunMat);
  tile.add(sun);
  const halo = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: track(radialTexture(`rgba(${brand300.r * 255 | 0},${brand300.g * 255 | 0},${brand300.b * 255 | 0},0.9)`, "rgba(0,0,0,0)")), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false })));
  halo.scale.set(SUN_R * 4.6, SUN_R * 4.6, 1);
  halo.position.z = -0.6;
  halo.material.opacity = 0.42;
  tile.add(halo);
  const corona = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: track(radialTexture(`rgba(${accent.r * 255 | 0},${accent.g * 255 | 0},${accent.b * 255 | 0},0.55)`, "rgba(0,0,0,0)")), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false })));
  corona.scale.set(SUN_R * 3.0, SUN_R * 3.0, 1);
  corona.material.opacity = 0.35;
  corona.position.z = -0.4;
  tile.add(corona);
  // the sun lights the planets
  const sunLight = new THREE.PointLight(0xfff4e6, 45, 0, 2);
  tile.add(sunLight);

  /** fit the logo inside a circle on the sun's face (any aspect ratio; its corners touch the circle at most) */
  const fitLogo = (aspect: number) => {
    const rho = 0.68;
    const a = Math.max(0.1, aspect);
    const d = Math.sqrt(1 + a * a);
    sunUniforms.uLogoSize.value.set((rho * a) / d, rho / d);
  };
  const setTexture = (tex: THREE.Texture, aspect: number) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    sunUniforms.uLogo.value = track(tex);
    sunUniforms.uHasLogo.value = 1;
    fitLogo(aspect);
  };
  const initialsTexture = () => {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 256;
    const g = c.getContext("2d")!;
    g.fillStyle = hex(brand700);
    g.font = "800 150px 'Plus Jakarta Sans', system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(initials(opts.name), 256, 136);
    setTexture(new THREE.CanvasTexture(c), 2);
  };
  if (opts.logoUrl) {
    new THREE.TextureLoader().load(
      opts.logoUrl,
      (t) => setTexture(t, (t.image as any).width / (t.image as any).height || 1.6),
      undefined,
      initialsTexture
    );
  } else initialsTexture();

  /* ── aura: two thin rings of light with a travelling comet, circling the sun ── */
  const auraMat = (speed: number, color: THREE.Color) =>
    track(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        uniforms: { uTime: { value: 0 }, uSpeed: { value: speed }, uColor: { value: color } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform float uTime; uniform float uSpeed; uniform vec3 uColor; varying vec2 vUv;
          void main(){ float f = fract(vUv.x - uTime * uSpeed); float head = pow(f, 12.0) * 4.0 + pow(f, 3.0) * 0.6; float a = 0.09 + head;
          gl_FragColor = vec4(uColor * (0.6 + head * 1.6), a); }`,
      })
    );
  const auraA = new THREE.Mesh(track(new THREE.TorusGeometry(SUN_R * 1.2, 0.016, 8, 360)), auraMat(0.11, new THREE.Color(1, 1, 1).lerp(brand300, 0.35)));
  auraA.rotation.set(1.18, 0.12, 0);
  const auraB = new THREE.Mesh(track(new THREE.TorusGeometry(SUN_R * 1.33, 0.011, 8, 360)), auraMat(-0.075, accent.clone()));
  auraB.rotation.set(1.42, -0.42, 0.3);
  tile.add(auraA, auraB);

  /* ── the planets: tilted orbits around the sun (lit by it) ── */
  const system = new THREE.Group();
  system.rotation.set(1.22, 0, -0.18); // same plane as the client belt
  world.add(system);
  const orbitLine = (r: number, opacity: number) => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 200; i++) pts.push(new THREE.Vector3(Math.cos((i / 200) * Math.PI * 2) * r, Math.sin((i / 200) * Math.PI * 2) * r, 0));
    const line = new THREE.Line(track(new THREE.BufferGeometry().setFromPoints(pts)), track(new THREE.LineBasicMaterial({ color: brand300, transparent: true, opacity, toneMapped: false })));
    system.add(line);
  };
  type Planet = { mesh: THREE.Object3D; r: number; speed: number; phase: number; spin: number };
  const planets: Planet[] = [];
  const planet = (r: number, size: number, color: THREE.Color, speed: number, phase: number, extras?: (g: THREE.Group) => void) => {
    orbitLine(r, 0.12);
    const g = new THREE.Group();
    const m = new THREE.Mesh(track(new THREE.SphereGeometry(size, 40, 40)), track(new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.15, emissive: color.clone().multiplyScalar(0.12) })));
    g.add(m);
    extras?.(g);
    system.add(g);
    planets.push({ mesh: g, r, speed, phase, spin: 0.4 + Math.random() * 0.6 });
  };
  planet(SUN_R * 1.65, 0.15, brand300.clone(), 0.42, 0.6);
  planet(SUN_R * 2.15, 0.21, accent.clone(), 0.27, 2.4, (g) => {
    const moon = new THREE.Mesh(track(new THREE.SphereGeometry(0.06, 20, 20)), track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 })));
    moon.position.set(0.42, 0, 0.1);
    moon.name = "moon";
    g.add(moon);
  });
  planet(SUN_R * 3.05, 0.26, brand500.clone().lerp(new THREE.Color(1, 1, 1), 0.2), 0.15, 4.2, (g) => {
    const ring = new THREE.Mesh(track(new THREE.RingGeometry(0.42, 0.62, 64)), track(new THREE.MeshBasicMaterial({ color: accent.clone().lerp(new THREE.Color(1, 1, 1), 0.4), transparent: true, opacity: 0.55, side: THREE.DoubleSide, toneMapped: false })));
    ring.rotation.set(0.35, 0.5, 0);
    g.add(ring);
  });
  planet(SUN_R * 3.6, 0.12, new THREE.Color(1, 1, 1).lerp(brand300, 0.6), 0.1, 1.1);

  /* ── 01 leads: particle streams flowing from sources into the logo ── */
  const SOURCES = 8;
  const N = 1800;
  const anchors: THREE.Vector3[] = [];
  for (let i = 0; i < SOURCES; i++) {
    const a = (i / SOURCES) * Math.PI * 2 + 0.3;
    anchors.push(new THREE.Vector3(Math.cos(a) * 8.2, Math.sin(a) * 4.6 + (i % 2 ? 0.6 : -0.6), -2.5 + (i % 3) * 1.4));
  }
  const aStart = new Float32Array(N * 3);
  const aCtrl = new Float32Array(N * 3);
  const aEnd = new Float32Array(N * 3);
  const aOff = new Float32Array(N);
  const aSpd = new Float32Array(N);
  const aSize = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const s = anchors[i % SOURCES];
    const j = () => (Math.random() - 0.5) * 0.9;
    aStart.set([s.x + j(), s.y + j(), s.z + j()], i * 3);
    const perp = new THREE.Vector3(-s.y, s.x, 0).normalize().multiplyScalar(1.6 + Math.random() * 1.2);
    aCtrl.set([s.x * 0.45 + perp.x + j(), s.y * 0.45 + perp.y + j(), Math.min(s.z * 0.4 - 0.6 + j(), -0.4)], i * 3);
    const ea = Math.random() * Math.PI * 2;
    aEnd.set([Math.cos(ea) * (TW * 0.56 + Math.random() * 0.25), Math.sin(ea) * (TH * 0.6 + Math.random() * 0.2), -0.35], i * 3);
    aOff[i] = Math.random();
    aSpd[i] = 0.07 + Math.random() * 0.07;
    aSize[i] = 0.6 + Math.random() * 1.2;
  }
  const leadGeo = track(new THREE.BufferGeometry());
  leadGeo.setAttribute("position", new THREE.BufferAttribute(aStart, 3));
  leadGeo.setAttribute("aStart", new THREE.BufferAttribute(aStart, 3));
  leadGeo.setAttribute("aCtrl", new THREE.BufferAttribute(aCtrl, 3));
  leadGeo.setAttribute("aEnd", new THREE.BufferAttribute(aEnd, 3));
  leadGeo.setAttribute("aOff", new THREE.BufferAttribute(aOff, 1));
  leadGeo.setAttribute("aSpd", new THREE.BufferAttribute(aSpd, 1));
  leadGeo.setAttribute("aSize", new THREE.BufferAttribute(aSize, 1));
  const leadMat = track(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      uniforms: { uTime: { value: 0 }, uI: { value: 1 }, uA: { value: brand300.clone().multiplyScalar(1.3) }, uB: { value: new THREE.Color(1.25, 1.25, 1.3) }, uPx: { value: renderer.getPixelRatio() } },
      vertexShader: /* glsl */ `
        attribute vec3 aStart; attribute vec3 aCtrl; attribute vec3 aEnd; attribute float aOff; attribute float aSpd; attribute float aSize;
        uniform float uTime; uniform float uI; uniform vec3 uA; uniform vec3 uB; uniform float uPx;
        varying vec3 vColor; varying float vAlpha;
        void main(){
          float t = fract(uTime * aSpd + aOff);
          float e = t * t * (3.0 - 2.0 * t);
          vec3 p = mix(mix(aStart, aCtrl, e), mix(aCtrl, aEnd, e), e);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uPx * (40.0 / -mv.z) * (0.6 + 0.7 * (1.0 - t));
          vColor = mix(uA, uB, t);
          vAlpha = smoothstep(0.0, 0.18, t) * (1.0 - smoothstep(0.78, 1.0, t)) * uI * 0.95;
        }`,
      fragmentShader: SOFT_POINT_FRAG,
    })
  );
  const leadPts = new THREE.Points(leadGeo, leadMat);
  leadPts.frustumCulled = false; // positions are computed in the shader
  world.add(leadPts);
  const beaconTex = track(radialTexture("rgba(255,255,255,1)", "rgba(255,255,255,0)", 128));

  /* ── 02 clients: an orbiting constellation (journey ring) with stage nodes ── */
  const clients = new THREE.Group();
  clients.rotation.set(1.22, 0, -0.18);
  world.add(clients);
  const CN = 40;
  const R2 = SUN_R * 2.5;
  const nodeGeo = track(new THREE.SphereGeometry(0.032, 10, 10));
  const nodeMat = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).lerp(brand300, 0.45).multiplyScalar(1.15), toneMapped: false, transparent: true, opacity: 0.9 }));
  const nodes = new THREE.InstancedMesh(nodeGeo, nodeMat, CN);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < CN; i++) {
    const a = (i / CN) * Math.PI * 2;
    const big = i % 8 === 0;
    m4.makeScale(big ? 1.8 : 1, big ? 1.8 : 1, big ? 1.8 : 1).setPosition(Math.cos(a) * R2, Math.sin(a) * R2, 0);
    nodes.setMatrixAt(i, m4);
  }
  clients.add(nodes);
  const stageMat = track(new THREE.MeshBasicMaterial({ color: accent.clone().multiplyScalar(1.5), toneMapped: false, transparent: true, opacity: 0.95 }));
  const stages = new THREE.InstancedMesh(track(new THREE.SphereGeometry(0.075, 16, 16)), stageMat, 5);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.2;
    m4.makeTranslation(Math.cos(a) * R2, Math.sin(a) * R2, 0);
    stages.setMatrixAt(i, m4);
  }
  clients.add(stages);
  const ringPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 256; i++) {
    const a = (i / 256) * Math.PI * 2;
    ringPts.push(new THREE.Vector3(Math.cos(a) * R2, Math.sin(a) * R2, 0));
  }
  const ringMat = track(new THREE.LineBasicMaterial({ color: brand300, transparent: true, opacity: 0.28, toneMapped: false }));
  clients.add(new THREE.Line(track(new THREE.BufferGeometry().setFromPoints(ringPts)), ringMat));
  // a highlight travelling the journey ring
  const runner = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: beaconTex, color: accent.clone().multiplyScalar(1.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false })));
  runner.scale.setScalar(0.45);
  clients.add(runner);

  /* ── 03 AI: neural sphere (fibonacci points + nearest-neighbour synapses + pulses) ── */
  const ai = new THREE.Group();
  world.add(ai);
  const AN = 150;
  const R3 = 6.1;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < AN; i++) {
    const y = 1 - (i / (AN - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = i * Math.PI * (3 - Math.sqrt(5));
    pts.push(new THREE.Vector3(Math.cos(th) * r * R3, y * R3 * 0.72, Math.sin(th) * r * R3));
  }
  const edges: [number, number][] = [];
  const seen = new Set<string>();
  pts.forEach((p, i) => {
    pts
      .map((q, j) => ({ j, d: p.distanceToSquared(q) }))
      .filter((x) => x.j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
      .forEach(({ j }) => {
        const k = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (!seen.has(k)) {
          seen.add(k);
          edges.push([i, j]);
        }
      });
  });
  const lineArr = new Float32Array(edges.length * 6);
  edges.forEach(([a, b], i) => lineArr.set([pts[a].x, pts[a].y, pts[a].z, pts[b].x, pts[b].y, pts[b].z], i * 6));
  const synGeo = track(new THREE.BufferGeometry());
  synGeo.setAttribute("position", new THREE.BufferAttribute(lineArr, 3));
  const synMat = track(new THREE.LineBasicMaterial({ color: brand300, transparent: true, opacity: 0.1, toneMapped: false, depthWrite: false }));
  ai.add(new THREE.LineSegments(synGeo, synMat));
  const neuGeo = track(new THREE.BufferGeometry().setFromPoints(pts));
  const neuMat = track(new THREE.PointsMaterial({ color: new THREE.Color(1, 1, 1).lerp(brand300, 0.5), size: 0.045, transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false }));
  ai.add(new THREE.Points(neuGeo, neuMat));
  // pulses along synapses
  const PN = 260;
  const pA = new Float32Array(PN * 3);
  const pB = new Float32Array(PN * 3);
  const pOff = new Float32Array(PN);
  for (let i = 0; i < PN; i++) {
    const [a, b] = edges[(Math.random() * edges.length) | 0];
    pA.set([pts[a].x, pts[a].y, pts[a].z], i * 3);
    pB.set([pts[b].x, pts[b].y, pts[b].z], i * 3);
    pOff[i] = Math.random();
  }
  const pulseGeo = track(new THREE.BufferGeometry());
  pulseGeo.setAttribute("position", new THREE.BufferAttribute(pA, 3));
  pulseGeo.setAttribute("aA", new THREE.BufferAttribute(pA, 3));
  pulseGeo.setAttribute("aB", new THREE.BufferAttribute(pB, 3));
  pulseGeo.setAttribute("aOff", new THREE.BufferAttribute(pOff, 1));
  const pulseMat = track(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      uniforms: { uTime: { value: 0 }, uI: { value: 0.5 }, uC: { value: accent.clone().lerp(new THREE.Color(1, 1, 1), 0.3) }, uPx: { value: renderer.getPixelRatio() } },
      vertexShader: /* glsl */ `
        attribute vec3 aA; attribute vec3 aB; attribute float aOff; uniform float uTime; uniform float uI; uniform vec3 uC; uniform float uPx;
        varying vec3 vColor; varying float vAlpha;
        void main(){
          float t = fract(uTime * 0.35 + aOff);
          vec4 mv = modelViewMatrix * vec4(mix(aA, aB, t), 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uPx * (30.0 / -mv.z);
          vColor = uC; vAlpha = sin(t * 3.14159) * uI;
        }`,
      fragmentShader: SOFT_POINT_FRAG,
    })
  );
  const pulsePts = new THREE.Points(pulseGeo, pulseMat);
  pulsePts.frustumCulled = false;
  ai.add(pulsePts);

  /* ── post-processing: bloom for the lights only (threshold keeps the sun's face and logo crisp) ── */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.62, 0.38, 0.97);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  /* ── sizing, pointer, visibility ── */
  let w = 0;
  let h = 0;
  const resize = () => {
    w = el.clientWidth;
    h = el.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    // keep the whole composition in frame on narrow / short panels
    camera.position.z = Math.max(15.5, 17 * Math.max(1, 0.82 / camera.aspect));
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(el);
  resize();

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const onMove = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    pointer.tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
    pointer.ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
  };
  const onLeave = () => {
    pointer.tx = 0;
    pointer.ty = 0;
  };
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerleave", onLeave);

  let visible = true;
  const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
  io.observe(el);

  /* ── the story: 3 phases, each layer takes the stage in turn ── */
  const PHASE = opts.phaseSeconds || 4.5;
  let lastPhase = -1;
  const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
  const focus = { leads: 1, clients: 0.5, ai: 0.5 };
  const clock = new THREE.Clock();
  let t = reduce ? 6.5 : 0;

  const frame = () => {
    if (!w || !h) resize();
    if (!w || !h) return;
    const dt = Math.min(clock.getDelta(), 0.25);
    if (!reduce) t += dt;
    const phase = Math.floor(t / PHASE) % 3;
    if (phase !== lastPhase) {
      lastPhase = phase;
      opts.onPhase?.(phase);
    }
    const k = 1 - Math.pow(0.0015, dt); // frame-rate independent easing
    focus.leads = lerp(focus.leads, phase === 0 ? 1.15 : 0.5, k);
    focus.clients = lerp(focus.clients, phase === 1 ? 1 : 0.4, k);
    focus.ai = lerp(focus.ai, phase === 2 ? 1 : 0.35, k);

    leadMat.uniforms.uTime.value = t;
    leadMat.uniforms.uI.value = focus.leads;
    (auraA.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    (auraB.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    auraA.rotation.z = t * 0.12;
    auraB.rotation.z = -t * 0.09;

    clients.rotation.z = t * 0.06;
    sunUniforms.uTime.value = t;
    for (const p of planets) {
      const a = p.phase + t * p.speed;
      p.mesh.position.set(Math.cos(a) * p.r, Math.sin(a) * p.r, 0);
      p.mesh.rotation.z = t * p.spin;
      const moon = p.mesh.getObjectByName("moon");
      if (moon) moon.position.set(Math.cos(t * 1.6) * 0.42, Math.sin(t * 1.6) * 0.42, 0.05);
    }
    nodeMat.opacity = 0.35 + 0.6 * focus.clients;
    stageMat.opacity = 0.4 + 0.6 * focus.clients;
    ringMat.opacity = 0.1 + 0.3 * focus.clients;
    const ra = t * 0.55;
    runner.position.set(Math.cos(ra) * R2, Math.sin(ra) * R2, 0);
    (runner.material as THREE.SpriteMaterial).opacity = focus.clients;

    ai.rotation.y = t * 0.045;
    ai.rotation.x = Math.sin(t * 0.1) * 0.08;
    synMat.opacity = 0.035 + 0.09 * focus.ai;
    neuMat.opacity = 0.15 + 0.45 * focus.ai;
    pulseMat.uniforms.uTime.value = t;
    pulseMat.uniforms.uI.value = 0.25 + 0.9 * focus.ai;

    // tile floats and gently follows the pointer; the camera drifts for a cinematic feel
    pointer.x = lerp(pointer.x, pointer.tx, k * 0.6);
    pointer.y = lerp(pointer.y, pointer.ty, k * 0.6);
    tile.position.y = Math.sin(t * 0.8) * 0.08;
    tile.rotation.y = pointer.x * 0.12;
    tile.rotation.x = pointer.y * 0.08;
    world.rotation.y = pointer.x * 0.08 + Math.sin(t * 0.12) * 0.05;
    world.rotation.x = pointer.y * 0.05;
    camera.position.x = Math.sin(t * 0.07) * 0.6;
    camera.lookAt(0, 0.35, 0);

    composer.render();
  };

  let running = false;
  const loop = () => {
    if (!visible || document.hidden) return;
    frame();
  };
  if (reduce) {
    // one still frame, redrawn on resize only
    frame();
    ro.disconnect();
    const ro2 = new ResizeObserver(() => {
      resize();
      frame();
    });
    ro2.observe(el);
    disposables.push({ dispose: () => ro2.disconnect() });
  } else {
    renderer.setAnimationLoop(loop);
    running = true;
  }
  const onVis = () => {
    if (!document.hidden) clock.getDelta(); // don't jump after returning to the tab
  };
  document.addEventListener("visibilitychange", onVis);

  return () => {
    if (running) renderer.setAnimationLoop(null);
    ro.disconnect();
    io.disconnect();
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerleave", onLeave);
    document.removeEventListener("visibilitychange", onVis);
    disposables.forEach((d) => d.dispose());
    (scene.background as THREE.Texture)?.dispose?.();
    composer.dispose?.();
    renderer.dispose();
    canvas.remove();
  };
}
