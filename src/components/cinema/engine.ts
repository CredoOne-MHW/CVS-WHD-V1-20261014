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

function roundedRect(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
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
  world.position.y = 1.15; // leave room for the headline below
  scene.add(world);
  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);

  /* ── 0. logo on a floating glass tile ── */
  const tile = new THREE.Group();
  world.add(tile);
  const TW = 3.3;
  const TH = 2.2;
  const depth = 0.16;
  const panelGeo = track(new THREE.ExtrudeGeometry(roundedRect(TW, TH, 0.5), { depth, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 6, curveSegments: 24 }));
  panelGeo.translate(0, 0, -depth / 2);
  const panelMat = track(new THREE.MeshPhysicalMaterial({ color: brand300.clone().lerp(new THREE.Color(1, 1, 1), 0.35).multiplyScalar(0.85), roughness: 0.38, metalness: 0.05, clearcoat: 0.5, clearcoatRoughness: 0.3 }));
  tile.add(new THREE.Mesh(panelGeo, panelMat));
  // the face: a soft white-to-pearl gradient with a hairline inner border, exactly as designed (not tone-mapped)
  const faceTex = (() => {
    const c = document.createElement("canvas");
    c.width = 660;
    c.height = 440;
    const g = c.getContext("2d")!;
    const r = 96;
    const path = (x: number, y: number, w: number, h: number, rr: number) => {
      g.beginPath();
      g.moveTo(x + rr, y);
      g.arcTo(x + w, y, x + w, y + h, rr);
      g.arcTo(x + w, y + h, x, y + h, rr);
      g.arcTo(x, y + h, x, y, rr);
      g.arcTo(x, y, x + w, y, rr);
      g.closePath();
    };
    const grd = g.createLinearGradient(0, 0, 0, c.height);
    grd.addColorStop(0, "#f2f3f9");
    grd.addColorStop(1, "#e2e5f0");
    path(0, 0, c.width, c.height, r);
    g.fillStyle = grd;
    g.fill();
    path(10, 10, c.width - 20, c.height - 20, r - 10);
    g.strokeStyle = "rgba(255,255,255,.55)";
    g.lineWidth = 3;
    g.stroke();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return track(t);
  })();
  const face = new THREE.Mesh(track(new THREE.PlaneGeometry(TW, TH)), track(new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, toneMapped: false })));
  face.position.z = depth / 2 + 0.062;
  tile.add(face);
  const halo = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: track(radialTexture(`rgba(${brand300.r * 255 | 0},${brand300.g * 255 | 0},${brand300.b * 255 | 0},0.85)`, "rgba(0,0,0,0)")), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false })));
  halo.scale.set(8, 6, 1);
  halo.position.z = -0.8;
  halo.material.opacity = 0.55;
  tile.add(halo);
  const logoMat = track(new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false }));
  const logoMesh = new THREE.Mesh(track(new THREE.PlaneGeometry(1, 1)), logoMat);
  logoMesh.position.z = depth / 2 + 0.07;
  tile.add(logoMesh);
  /** contain-fit the logo inside the tile's safe area (never cropped, any aspect ratio) */
  const fitLogo = (aspect: number) => {
    const maxW = TW * 0.78;
    const maxH = TH * 0.7;
    let w = maxW;
    let h = w / aspect;
    if (h > maxH) {
      h = maxH;
      w = h * aspect;
    }
    logoMesh.scale.set(w, h, 1);
  };
  const setTexture = (tex: THREE.Texture, aspect: number) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    logoMat.map = track(tex);
    logoMat.needsUpdate = true;
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

  /* ── aura: two thin rings of light with a travelling comet, circling the tile ── */
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
  const auraA = new THREE.Mesh(track(new THREE.TorusGeometry(2.45, 0.018, 8, 360)), auraMat(0.11, new THREE.Color(1, 1, 1).lerp(brand300, 0.35)));
  auraA.rotation.set(1.18, 0.12, 0);
  const auraB = new THREE.Mesh(track(new THREE.TorusGeometry(2.75, 0.012, 8, 360)), auraMat(-0.075, accent.clone()));
  auraB.rotation.set(1.42, -0.42, 0.3);
  tile.add(auraA, auraB);

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
  const R2 = 4.3;
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

  /* ── post-processing: bloom for the lights only (threshold keeps the logo tile crisp) ── */
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
    tile.rotation.y = pointer.x * 0.22 + Math.sin(t * 0.35) * 0.06;
    tile.rotation.x = pointer.y * 0.16;
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
