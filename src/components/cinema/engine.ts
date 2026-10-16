/**
 * Cinematic login scene — "Neural Brain" (Three.js, WebGL). Loaded on demand — never part of the app bundle.
 *
 * A glowing 3D brain of neurons and synapses turns slowly; the brand's circular logo sits at its core with rings of
 * light (the "aura") circling it. The story cycles every few seconds:
 *   01 Leads from every source — sparks fly in from outside, land on the cortex and travel along synapses to the core.
 *   02 Clients, end to end      — client sparks flow back out of the core to a ring of client nodes around the brain.
 *   03 AI intelligence          — firing waves sweep through the whole network.
 * Colours come from the brand's CSS variables, so every company's scene is its own. The logo disc is drawn after the
 * bloom pass, so it keeps its exact colours and is never blurred or cropped (contain-fitted inside the circle).
 *
 * Performance: ~1.3k neurons + ~2k synapses in 2 draw calls, sparks in 1 draw call (CPU-updated, ~1k points), DPR
 * capped, paused when hidden / off-screen, one still frame for prefers-reduced-motion.
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
  return p.length === 3 && p.every((n) => !isNaN(n)) ? new THREE.Color().setRGB(p[0] / 255, p[1] / 255, p[2] / 255, THREE.SRGBColorSpace) : new THREE.Color(fallback);
};
const initials = (s: string) =>
  s
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "•";

/** deterministic random, so the brain is the same shape on every visit */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

/* shared GLSL: the AI firing wave over the network, and the "keep the logo clear" fade for things in front of it */
const NET_GLSL = /* glsl */ `
  uniform float uTime; uniform float uAI; uniform vec3 uCoreV;
  float fireWave(vec3 p){
    float w1 = sin(dot(p, vec3(0.86, 0.38, 0.33)) * 1.7 - uTime * 2.4);
    float w2 = sin(length(p) * 2.3 - uTime * 3.0);
    return pow(max(w1, 0.0), 10.0) * 0.9 + pow(max(w2, 0.0), 16.0) * 0.7;
  }
  float coreFade(vec4 mv){
    float front = step(uCoreV.z, mv.z);
    float d = length(mv.xy - uCoreV.xy);
    return mix(1.0, 0.18 + 0.82 * smoothstep(1.2, 2.1, d), front);
  }`;

const SOFT_POINT_FRAG = /* glsl */ `
  varying vec3 vColor; varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    float core = smoothstep(0.18, 0.0, d);
    gl_FragColor = vec4(vColor * (0.7 + a * 0.6 + core * 1.2), a * vAlpha);
    #include <colorspace_fragment>
  }`;

type Spark = {
  pts: THREE.Vector3[];
  cum: number[];
  len: number;
  s: number;
  speed: number;
  color: THREE.Color;
  alive: boolean;
  out: boolean;
  node: number;
};

export function start(el: HTMLElement, opts: CinemaOptions) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const brand200 = cssColor(el, "--brand-200", "#c9cbff");
  const brand300 = cssColor(el, "--brand-300", "#a5a8ff");
  const brand500 = cssColor(el, "--brand-500", "#5b5fc7");
  const brand700 = cssColor(el, "--brand-700", "#2f3180");
  const brand950 = cssColor(el, "--brand-950", "#111233");
  const accent = cssColor(el, "--accent-300", "#f2d27a");
  const white = new THREE.Color(1, 1, 1);
  const hex = (c: THREE.Color) => `#${c.getHexString()}`;
  const rgba = (c: THREE.Color, a: number) => {
    const s = c.clone().convertLinearToSRGB();
    return `rgba(${(s.r * 255) | 0},${(s.g * 255) | 0},${(s.b * 255) | 0},${a})`;
  };

  /* ── renderer / scenes / camera ── */
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  const PR = Math.min(window.devicePixelRatio || 1, 1.75);
  renderer.setPixelRatio(PR);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const canvas = renderer.domElement;
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
  canvas.setAttribute("aria-hidden", "true");
  el.appendChild(canvas);

  const scene = new THREE.Scene();
  const bgInner = brand700.clone().lerp(brand950, 0.35);
  const bgOuter = brand950.clone().multiplyScalar(0.35);
  scene.background = radialTexture(hex(bgInner), hex(bgOuter), 512);
  const overlay = new THREE.Scene(); // drawn after bloom: the logo disc, crisp and in its exact colours
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0, 17);

  const world = new THREE.Group();
  world.position.y = 1.45; // leave room for the headline below
  scene.add(world);
  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);

  const brain = new THREE.Group();
  brain.rotation.set(0.2, 0.55, 0);
  brain.scale.setScalar(1.22);
  world.add(brain);

  /* ── 1. neurons: a brain-shaped cloud — two hemispheres with folds, a fissure, a cerebellum and a stem ── */
  const R = rng(20261016);
  const N = 1900;
  const pos: THREE.Vector3[] = [];
  const sizes: number[] = [];
  const seeds: number[] = [];
  const ell = (x: number, y: number, z: number, cx: number, cy: number, cz: number, ax: number, ay: number, az: number) =>
    ((x - cx) / ax) ** 2 + ((y - cy) / ay) ** 2 + ((z - cz) / az) ** 2;
  const shape = (x: number, y: number, z: number) => {
    const ay = y < 0.15 ? 1.45 : 1.9; // flatter underside
    const hemi = Math.min(ell(x, y, z, 0.95, 0.15, 0.1, 1.6, ay, 2.75), ell(x, y, z, -0.95, 0.15, 0.1, 1.6, ay, 2.75));
    const fold = 0.075 * Math.sin(x * 4.3 + 1.3) * Math.sin(y * 3.9) * Math.sin(z * 4.6 + 0.7) + 0.03 * Math.sin(z * 9.0 + y * 6.0);
    const cere = ell(x, y, z, 0, -1.25, -2.0, 1.35, 0.68, 0.9);
    return { hemi: hemi + fold, cere: cere + fold * 0.6 };
  };
  let guard = 0;
  while (pos.length < N && guard++ < 400000) {
    const x = (R() * 2 - 1) * 2.7;
    const y = -2.3 + R() * 4.5;
    const z = (R() * 2 - 1) * 3.0;
    const r = Math.hypot(x, y, z);
    if (r < 1.15) continue; // the core cavity, where the logo lives
    const { hemi, cere } = shape(x, y, z);
    const fissure = Math.abs(x) < 0.13 && y > 0.1;
    let ok = false;
    let big = false;
    if (!fissure && hemi <= 1 && hemi > 0.8) ok = true; // the cortex shell
    else if (!fissure && hemi <= 0.8 && R() < 0.035) ok = true; // sparse interior
    else if (cere <= 1 && cere > 0.6 && R() < 0.75) ok = true;
    else if (Math.hypot(x, z + 1.0) < 0.32 && y < -1.1 && y > -2.3 && R() < 0.5) ok = true; // stem
    if (!ok) continue;
    if (R() < 0.05) big = true;
    pos.push(new THREE.Vector3(x, y, z));
    sizes.push(big ? 1.35 + R() * 0.5 : 0.45 + R() * 0.4);
    seeds.push(R());
  }
  const n = pos.length;

  const netUniforms = {
    uTime: { value: 0 },
    uAI: { value: 0.3 },
    uCoreV: { value: new THREE.Vector3() },
    uScale: { value: 100 },
    uBase: { value: brand300.clone().lerp(white, 0.15) },
    uHot: { value: white.clone().lerp(accent, 0.25) },
    uSynA: { value: 0.12 },
  };
  const nGeo = track(new THREE.BufferGeometry());
  nGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos.flatMap((p) => [p.x, p.y, p.z]), 3));
  nGeo.setAttribute("aSize", new THREE.Float32BufferAttribute(sizes, 1));
  nGeo.setAttribute("aSeed", new THREE.Float32BufferAttribute(seeds, 1));
  const neuronMat = track(
    new THREE.ShaderMaterial({
      uniforms: netUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        ${NET_GLSL}
        uniform float uScale; uniform vec3 uBase; uniform vec3 uHot;
        attribute float aSize; attribute float aSeed;
        varying vec3 vColor; varying float vAlpha;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float twinkle = pow(max(sin(uTime * 1.1 + aSeed * 60.0), 0.0), 24.0) * 0.9;
          float fire = clamp(fireWave(position) * uAI + twinkle, 0.0, 1.6);
          vColor = mix(uBase, uHot, clamp(fire, 0.0, 1.0)) * (0.5 + fire * 0.8);
          float depth = smoothstep(-22.0, -13.0, mv.z); // farther = dimmer
          vAlpha = (0.38 + 0.62 * depth + fire * 0.6) * coreFade(mv);
          gl_PointSize = aSize * uScale * (1.0 + fire * 0.8) / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: SOFT_POINT_FRAG,
    })
  );
  const neurons = new THREE.Points(nGeo, neuronMat);
  neurons.frustumCulled = false;
  brain.add(neurons);

  /* ── 2. synapses: each neuron to its nearest neighbours ── */
  const adj: number[][] = Array.from({ length: n }, () => []);
  const K = 3;
  const MAXD2 = 0.85 * 0.85;
  const seg: number[] = [];
  for (let i = 0; i < n; i++) {
    const best: [number, number][] = [];
    const a = pos[i];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const d2 = a.distanceToSquared(pos[j]);
      if (d2 > MAXD2) continue;
      if (best.length < K) best.push([d2, j]);
      else {
        let w = 0;
        for (let q = 1; q < K; q++) if (best[q][0] > best[w][0]) w = q;
        if (d2 < best[w][0]) best[w] = [d2, j];
      }
    }
    for (const [, j] of best) {
      if (adj[i].includes(j)) continue;
      adj[i].push(j);
      adj[j].push(i);
      seg.push(a.x, a.y, a.z, pos[j].x, pos[j].y, pos[j].z);
    }
  }
  // a few long axons from the inner neurons to the core
  const inner = pos.map((p, i) => [p.length(), i] as [number, number]).sort((a, b) => a[0] - b[0]).slice(0, 36).map(([, i]) => i);
  for (const i of inner) seg.push(pos[i].x, pos[i].y, pos[i].z, pos[i].x * 0.55, pos[i].y * 0.55, pos[i].z * 0.55);
  const sGeo = track(new THREE.BufferGeometry());
  sGeo.setAttribute("position", new THREE.Float32BufferAttribute(seg, 3));
  const synMat = track(
    new THREE.ShaderMaterial({
      uniforms: netUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        ${NET_GLSL}
        uniform vec3 uBase; uniform vec3 uHot; uniform float uSynA;
        varying vec3 vColor; varying float vAlpha;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float fire = clamp(fireWave(position) * uAI, 0.0, 1.2);
          vColor = mix(uBase, uHot, clamp(fire, 0.0, 1.0)) * (0.6 + fire);
          float depth = smoothstep(-22.0, -13.0, mv.z);
          vAlpha = (uSynA * (0.45 + 0.55 * depth) + fire * 0.35) * coreFade(mv);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `varying vec3 vColor; varying float vAlpha; void main(){ gl_FragColor = vec4(vColor, vAlpha);
#include <colorspace_fragment>
}`,
    })
  );
  const synapses = new THREE.LineSegments(sGeo, synMat);
  synapses.frustumCulled = false;
  brain.add(synapses);

  /* ── 3. the client ring: client nodes orbiting the brain ── */
  const ring = new THREE.Group();
  ring.position.y = -0.35;
  brain.add(ring);
  const CN = 26;
  const RING_R = 3.25;
  const clientPos: THREE.Vector3[] = [];
  for (let i = 0; i < CN; i++) {
    const a = (i / CN) * Math.PI * 2 + (R() - 0.5) * 0.12;
    clientPos.push(new THREE.Vector3(Math.cos(a) * RING_R, (R() - 0.5) * 0.25, Math.sin(a) * RING_R));
  }
  const cGeo = track(new THREE.BufferGeometry());
  cGeo.setAttribute("position", new THREE.Float32BufferAttribute(clientPos.flatMap((p) => [p.x, p.y, p.z]), 3));
  const clientFlash = new Float32Array(CN);
  cGeo.setAttribute("aFlash", new THREE.BufferAttribute(clientFlash, 1));
  const clientMat = track(
    new THREE.ShaderMaterial({
      uniforms: { uScale: netUniforms.uScale, uI: { value: 0.5 }, uColor: { value: accent.clone() } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uScale; uniform float uI; uniform vec3 uColor; attribute float aFlash;
        varying vec3 vColor; varying float vAlpha;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vColor = mix(uColor, vec3(1.0), aFlash * 0.6) * (0.7 + aFlash);
          float depth = smoothstep(-24.0, -12.0, mv.z);
          vAlpha = (0.25 + 0.75 * uI) * (0.35 + 0.65 * depth) + aFlash;
          gl_PointSize = (2.4 + aFlash * 2.2) * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: SOFT_POINT_FRAG,
    })
  );
  const clients = new THREE.Points(cGeo, clientMat);
  clients.frustumCulled = false;
  ring.add(clients);
  const orbitMat = track(new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }));
  const orbit = new THREE.LineLoop(
    track(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 160 }, (_, i) => new THREE.Vector3(Math.cos((i / 160) * Math.PI * 2) * RING_R, 0, Math.sin((i / 160) * Math.PI * 2) * RING_R)))),
    orbitMat
  );
  ring.add(orbit);

  /* ── 4. dust: a deep starfield for parallax ── */
  const dust: number[] = [];
  for (let i = 0; i < 700; i++) dust.push((R() * 2 - 1) * 16, (R() * 2 - 1) * 11, -4 - R() * 12);
  const dGeo = track(new THREE.BufferGeometry());
  dGeo.setAttribute("position", new THREE.Float32BufferAttribute(dust, 3));
  const dustMat = track(new THREE.PointsMaterial({ color: brand200, size: 0.035, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
  const dustPts = new THREE.Points(dGeo, dustMat);
  scene.add(dustPts);

  /* ── 5. the core: logo disc (overlay), halo, glowing rim, aura comets and arrival ripples ── */
  const DISC_R = 1.05;
  const core = new THREE.Group();
  world.add(core);
  const halo = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: track(radialTexture(rgba(brand300, 0.45), "rgba(0,0,0,0)")), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true })));
  halo.scale.set(DISC_R * 3.6, DISC_R * 3.6, 1);
  halo.material.opacity = 0.55;
  halo.renderOrder = 5;
  core.add(halo);
  const rimGlow = new THREE.Mesh(
    track(new THREE.TorusGeometry(DISC_R * 1.01, 0.02, 12, 160)),
    track(new THREE.MeshBasicMaterial({ color: brand300.clone().lerp(white, 0.4), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }))
  );
  rimGlow.renderOrder = 6;
  core.add(rimGlow);
  const auraMat = (speed: number, color: THREE.Color) =>
    track(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uSpeed: { value: speed }, uColor: { value: color } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform float uTime; uniform float uSpeed; uniform vec3 uColor; varying vec2 vUv;
          void main(){ float f = fract(vUv.x - uTime * uSpeed); float head = pow(f, 14.0) * 2.4 + pow(f, 3.0) * 0.45; float a = 0.08 + head;
          gl_FragColor = vec4(uColor * (0.6 + head * 1.6), a);
#include <colorspace_fragment>
}`,
      })
    );
  const auraA = new THREE.Mesh(track(new THREE.TorusGeometry(DISC_R * 1.2, 0.017, 8, 320)), auraMat(0.12, white.clone().lerp(brand300, 0.3)));
  auraA.rotation.set(0.42, 0.18, 0);
  const auraB = new THREE.Mesh(track(new THREE.TorusGeometry(DISC_R * 1.36, 0.012, 8, 320)), auraMat(-0.08, accent.clone()));
  auraB.rotation.set(-0.35, -0.4, 0.3);
  auraA.renderOrder = auraB.renderOrder = 7;
  core.add(auraA, auraB);
  const ripples = Array.from({ length: 4 }, () => {
    const m = new THREE.Mesh(
      track(new THREE.RingGeometry(DISC_R * 0.995, DISC_R * 1.015, 128)),
      track(new THREE.MeshBasicMaterial({ color: brand200, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }))
    );
    m.renderOrder = 6;
    core.add(m);
    return { m, age: 99 };
  });
  let rippleIdx = 0;
  let lastRipple = 0;

  // the logo disc — white glass circle, logo contain-fitted inside it
  const discUniforms = {
    uLogo: { value: null as THREE.Texture | null },
    uHasLogo: { value: 0 },
    uLogoSize: { value: new THREE.Vector2(0.3, 0.2) },
    uEdge: { value: brand200.clone().lerp(white, 0.35) },
    uTime: { value: 0 },
  };
  const disc = new THREE.Mesh(
    track(new THREE.CircleGeometry(DISC_R, 128)),
    track(
      new THREE.ShaderMaterial({
        uniforms: discUniforms,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D uLogo; uniform float uHasLogo; uniform vec2 uLogoSize; uniform vec3 uEdge; uniform float uTime;
          varying vec2 vUv;
          void main(){
            vec2 p = vUv - 0.5;
            float r = length(p) * 2.0;
            vec3 col = mix(vec3(1.0), uEdge, smoothstep(0.55, 1.0, r) * 0.85);
            col += 0.05 * smoothstep(0.5, 0.0, length(p - vec2(-0.16, 0.2))); // glass highlight
            float sweep = smoothstep(0.06, 0.0, abs(p.x + p.y * 0.6 - mod(uTime * 0.18, 2.4) + 1.2)) * 0.05;
            col += sweep;
            if (uHasLogo > 0.5) {
              vec2 luv = p / uLogoSize * 0.5 + 0.5;
              if (luv.x >= 0.0 && luv.x <= 1.0 && luv.y >= 0.0 && luv.y <= 1.0) {
                vec4 lg = texture2D(uLogo, luv);
                col = mix(col, lg.rgb, lg.a);
              }
            }
            float a = smoothstep(1.0, 0.985, r);
            gl_FragColor = vec4(col, a);
            #include <colorspace_fragment>
          }`,
      })
    )
  );
  const discGroup = new THREE.Group();
  discGroup.add(disc);
  overlay.add(discGroup);

  /** contain-fit the logo inside the circle (any aspect ratio; its corners touch at most 68% of the radius) */
  const fitLogo = (aspect: number) => {
    const rho = 0.68;
    const a = Math.max(0.1, aspect);
    const d = Math.sqrt(1 + a * a);
    discUniforms.uLogoSize.value.set(((rho * a) / d) * 0.5, (rho / d) * 0.5);
  };
  const setTexture = (tex: THREE.Texture, aspect: number) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    discUniforms.uLogo.value = track(tex);
    discUniforms.uHasLogo.value = 1;
    fitLogo(aspect);
  };
  const initialsTexture = () => {
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const g = c.getContext("2d")!;
    g.fillStyle = hex(brand700);
    g.font = "800 230px 'Plus Jakarta Sans', system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(initials(opts.name), 256, 272);
    setTexture(new THREE.CanvasTexture(c), 1);
  };
  if (opts.logoUrl) {
    new THREE.TextureLoader().load(opts.logoUrl, (t) => setTexture(t, (t.image as any).width / (t.image as any).height || 1), undefined, initialsTexture);
  } else initialsTexture();

  /* ── 6. sparks: leads fly in → cortex → synapses → core; clients flow core → out → client ring ── */
  const SOURCES = [white.clone().lerp(brand300, 0.2), accent.clone(), new THREE.Color("#7dd3fc"), new THREE.Color("#86efac"), new THREE.Color("#f0abfc"), brand300.clone()];
  const POOL = 150;
  const TRAIL = 8;
  const TSTEP = 0.085;
  const sparks: Spark[] = Array.from({ length: POOL }, () => ({ pts: [], cum: [], len: 0, s: 0, speed: 1, color: new THREE.Color(), alive: false, out: false, node: -1 }));
  const spPos = new Float32Array(POOL * TRAIL * 3);
  const spCol = new Float32Array(POOL * TRAIL * 3);
  const spAlpha = new Float32Array(POOL * TRAIL);
  const spSize = new Float32Array(POOL * TRAIL);
  const spGeo = track(new THREE.BufferGeometry());
  spGeo.setAttribute("position", new THREE.BufferAttribute(spPos, 3).setUsage(THREE.DynamicDrawUsage));
  spGeo.setAttribute("aColor", new THREE.BufferAttribute(spCol, 3).setUsage(THREE.DynamicDrawUsage));
  spGeo.setAttribute("aAlpha", new THREE.BufferAttribute(spAlpha, 1).setUsage(THREE.DynamicDrawUsage));
  spGeo.setAttribute("aSize", new THREE.BufferAttribute(spSize, 1).setUsage(THREE.DynamicDrawUsage));
  const sparkMat = track(
    new THREE.ShaderMaterial({
      uniforms: { uScale: netUniforms.uScale },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uScale; attribute vec3 aColor; attribute float aAlpha; attribute float aSize;
        varying vec3 vColor; varying float vAlpha;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vColor = aColor * 1.15; vAlpha = aAlpha;
          gl_PointSize = aSize * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: SOFT_POINT_FRAG,
    })
  );
  const sparkPts = new THREE.Points(spGeo, sparkMat);
  sparkPts.frustumCulled = false;
  brain.add(sparkPts);

  const setPath = (sp: Spark, pts: THREE.Vector3[]) => {
    sp.pts = pts;
    sp.cum = [0];
    for (let i = 1; i < pts.length; i++) sp.cum.push(sp.cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    sp.len = sp.cum[sp.cum.length - 1];
    sp.s = 0;
    sp.alive = true;
  };
  const at = (sp: Spark, d: number, out: THREE.Vector3) => {
    if (d <= 0) return out.copy(sp.pts[0]);
    if (d >= sp.len) return out.copy(sp.pts[sp.pts.length - 1]);
    let i = 1;
    while (i < sp.cum.length - 1 && sp.cum[i] < d) i++;
    const a = sp.cum[i - 1];
    const k = (d - a) / (sp.cum[i] - a || 1);
    return out.copy(sp.pts[i - 1]).lerp(sp.pts[i], k);
  };
  const surface = pos.map((p, i) => [p.length(), i] as [number, number]).filter(([l]) => l > 1.9).map(([, i]) => i);
  const free = () => sparks.find((s) => !s.alive);
  const chainIn = (start: number) => {
    const path = [start];
    let cur = start;
    for (let step = 0; step < 14; step++) {
      const l = pos[cur].length();
      if (l < 1.6) break;
      const opts2 = adj[cur].filter((j) => pos[j].length() < l - 0.04).sort((a, b) => pos[a].length() - pos[b].length());
      if (!opts2.length) break;
      cur = opts2[Math.min(opts2.length - 1, (R() * 2) | 0)];
      path.push(cur);
    }
    return path;
  };
  const spawnLead = () => {
    const sp = free();
    if (!sp) return;
    const target = surface[(R() * surface.length) | 0];
    const tp = pos[target];
    // fly in from far outside, roughly from the target's side, on a gentle curve
    const dir = tp.clone().normalize();
    dir.x += (R() - 0.5) * 0.9;
    dir.y += (R() - 0.5) * 0.9;
    dir.normalize();
    const from = dir.clone().multiplyScalar(9 + R() * 3);
    const ctrl = from.clone().lerp(tp, 0.5).add(new THREE.Vector3((R() - 0.5) * 3, (R() - 0.5) * 3, (R() - 0.5) * 3));
    const curve = new THREE.QuadraticBezierCurve3(from, ctrl, tp.clone());
    const pts = curve.getPoints(14);
    for (const i of chainIn(target).slice(1)) pts.push(pos[i].clone());
    pts.push(new THREE.Vector3(0, 0, 0));
    setPath(sp, pts);
    sp.out = false;
    sp.node = -1;
    sp.speed = 3.6 + R() * 1.6;
    sp.color.copy(SOURCES[(R() * SOURCES.length) | 0]);
  };
  const _v = new THREE.Vector3();
  const clientLocal = (i: number, out: THREE.Vector3) => out.copy(clientPos[i]).applyMatrix4(ring.matrix); // ring → brain space
  const spawnClient = () => {
    const sp = free();
    if (!sp) return;
    const startN = inner[(R() * inner.length) | 0];
    const path = [startN];
    let cur = startN;
    for (let step = 0; step < 14; step++) {
      const l = pos[cur].length();
      const nx = adj[cur].filter((j) => pos[j].length() > l + 0.04).sort((a, b) => pos[b].length() - pos[a].length());
      if (!nx.length) break;
      cur = nx[Math.min(nx.length - 1, (R() * 2) | 0)];
      path.push(cur);
    }
    const node = (R() * CN) | 0;
    const pts = [new THREE.Vector3(0, 0, 0), ...path.map((i) => pos[i].clone()), clientLocal(node, new THREE.Vector3())];
    setPath(sp, pts);
    sp.out = true;
    sp.node = node;
    sp.speed = 3.0 + R() * 1.2;
    sp.color.copy(accent).lerp(white, R() * 0.3);
  };
  const ripple = () => {
    const r = ripples[rippleIdx++ % ripples.length];
    r.age = 0;
  };

  /* ── post-processing ── */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.45, 0.72);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let w = 0;
  let h = 0;
  const resize = () => {
    w = el.clientWidth;
    h = el.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.position.z = Math.max(16, 17 * Math.max(1, 0.86 / camera.aspect));
    camera.updateProjectionMatrix();
    netUniforms.uScale.value = 0.12 * h * PR;
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

  /* ── the story ── */
  const PHASE = opts.phaseSeconds || 4.5;
  let lastPhase = -1;
  const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
  const focus = { leads: 1, clients: 0.4, ai: 0.3 };
  const clock = new THREE.Clock();
  let t = 0;
  let leadAcc = 0;
  let clientAcc = 0;
  const coreW = new THREE.Vector3();

  let wall = 0; // captions follow real time even when frames are slow
  const update = (dt: number, real = dt) => {
    t += dt;
    wall += real;
    const phase = Math.floor(wall / PHASE) % 3;
    if (phase !== lastPhase) {
      lastPhase = phase;
      opts.onPhase?.(phase);
    }
    const k = 1 - Math.pow(0.002, dt);
    focus.leads = lerp(focus.leads, phase === 0 ? 1 : 0.25, k);
    focus.clients = lerp(focus.clients, phase === 1 ? 1 : 0.25, k);
    focus.ai = lerp(focus.ai, phase === 2 ? 1 : 0.22, k);

    // brain turns slowly; pointer adds a gentle tilt
    pointer.x = lerp(pointer.x, pointer.tx, k * 0.5);
    pointer.y = lerp(pointer.y, pointer.ty, k * 0.5);
    brain.rotation.y = 0.55 + t * (0.1 + focus.ai * 0.05) + pointer.x * 0.25;
    brain.rotation.x = 0.2 + pointer.y * 0.12;
    ring.rotation.y = -t * 0.12;
    ring.rotation.z = 0.12;
    brain.updateMatrixWorld();

    // spawn
    leadAcc += dt * (2.5 + 13 * focus.leads);
    while (leadAcc > 1) (leadAcc -= 1), spawnLead();
    clientAcc += dt * (1.2 + 9 * focus.clients);
    while (clientAcc > 1) (clientAcc -= 1), spawnClient();

    // advance sparks + write the point buffer
    for (let i = 0; i < POOL; i++) {
      const sp = sparks[i];
      if (sp.alive) {
        if (sp.out && sp.node >= 0) {
          // follow the moving client node
          const last = sp.pts.length - 1;
          clientLocal(sp.node, sp.pts[last]);
          sp.cum[last] = sp.cum[last - 1] + sp.pts[last].distanceTo(sp.pts[last - 1]);
          sp.len = sp.cum[last];
        }
        sp.s += sp.speed * dt;
        if (sp.s - TRAIL * TSTEP > sp.len) {
          sp.alive = false;
        } else if (sp.s > sp.len && !sp.out && sp.node === -1) {
          sp.node = -2; // arrived at the core
          if (t - lastRipple > 0.6) (lastRipple = t), ripple();
        } else if (sp.s > sp.len && sp.out && sp.node >= 0) {
          clientFlash[sp.node] = 1;
          sp.node = -3;
        }
      }
      for (let j = 0; j < TRAIL; j++) {
        const o = i * TRAIL + j;
        const d = sp.s - j * TSTEP;
        if (!sp.alive || d < 0 || d > sp.len) {
          spAlpha[o] = 0;
          spSize[o] = 0;
          continue;
        }
        at(sp, d, _v);
        spPos[o * 3] = _v.x;
        spPos[o * 3 + 1] = _v.y;
        spPos[o * 3 + 2] = _v.z;
        const fall = 1 - j / TRAIL;
        const fadeIn = Math.min(1, d / 1.2);
        const fadeOut = sp.out ? 1 : Math.min(1, (sp.len - d) / 0.6 + 0.15);
        spCol[o * 3] = sp.color.r;
        spCol[o * 3 + 1] = sp.color.g;
        spCol[o * 3 + 2] = sp.color.b;
        spAlpha[o] = fall * fall * fadeIn * fadeOut * (j === 0 ? 1 : 0.75);
        spSize[o] = (j === 0 ? 1.7 : 1.2) * (0.4 + 0.6 * fall);
      }
    }
    spGeo.attributes.position.needsUpdate = true;
    spGeo.attributes.aColor.needsUpdate = true;
    spGeo.attributes.aAlpha.needsUpdate = true;
    spGeo.attributes.aSize.needsUpdate = true;
    for (let i = 0; i < CN; i++) clientFlash[i] = Math.max(0, clientFlash[i] - dt * 1.6);
    cGeo.attributes.aFlash.needsUpdate = true;
    clientMat.uniforms.uI.value = focus.clients;
    orbitMat.opacity = 0.05 + 0.16 * focus.clients;

    // the network
    netUniforms.uTime.value = t;
    netUniforms.uAI.value = 0.18 + 1.0 * focus.ai;
    netUniforms.uSynA.value = 0.11 + 0.1 * focus.ai;

    // the core floats a little and faces the viewer; the aura circles it
    core.position.y = Math.sin(t * 0.8) * 0.06;
    core.rotation.y = pointer.x * 0.1;
    core.rotation.x = pointer.y * 0.08;
    (auraA.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    (auraB.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    auraA.rotation.z = t * 0.12;
    auraB.rotation.z = -t * 0.09;
    discUniforms.uTime.value = t;
    halo.material.opacity = 0.22 + 0.06 * Math.sin(t * 1.4) + 0.08 * focus.ai;
    for (const r of ripples) {
      r.age += dt;
      const s = 1 + r.age * 1.6;
      r.m.scale.set(s, s, 1);
      (r.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.22 * (1 - r.age / 1.0));
    }
    dustPts.rotation.z = t * 0.004;
    camera.position.x = Math.sin(t * 0.07) * 0.5;
    camera.position.y = Math.sin(t * 0.05) * 0.25;
    camera.lookAt(0, 0.3, 0);
  };

  const render = () => {
    if (!w || !h) resize();
    if (!w || !h) return;
    // keep neurons in front of the logo faint: the core's view-space position
    camera.updateMatrixWorld();
    world.updateMatrixWorld();
    core.getWorldPosition(coreW);
    netUniforms.uCoreV.value.copy(coreW).applyMatrix4(camera.matrixWorldInverse);
    discGroup.position.copy(coreW);
    discGroup.quaternion.copy(core.getWorldQuaternion(new THREE.Quaternion()));
    composer.render();
    const ac = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(overlay, camera);
    renderer.autoClear = ac;
  };

  let running = false;
  const loop = () => {
    if (!visible || document.hidden) return;
    const raw = Math.min(clock.getDelta(), 1);
    update(Math.min(raw, 0.1), raw);
    render();
  };
  if (reduce) {
    // one still frame mid-story (leads in flight, network firing), redrawn on resize only
    for (let i = 0; i < 160; i++) update(1 / 30);
    focus.ai = 0.7;
    netUniforms.uAI.value = 0.9;
    render();
    ro.disconnect();
    const ro2 = new ResizeObserver(() => {
      resize();
      render();
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
