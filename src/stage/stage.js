// Ithil's body on screen: a 3D VRM model (three.js + three-vrm) or a Live2D
// model (PixiJS + pixi-live2d-display). Both get the same controls: mood
// faces and poses, idle breathing and sway, blinking, looking at you,
// nodding while you talk, mouth shapes that follow her voice, camera
// presets, drag to turn and scroll to zoom.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import * as PIXI from 'pixi.js';
import { install as installUnsafeEval } from '@pixi/unsafe-eval';
installUnsafeEval(PIXI);

const MOODS = ['Calm', 'Curious', 'Happy', 'Focused', 'Frustrated', 'Sleepy', 'Thinking'];
export const POSES = { Calm: 'relaxed stand', Curious: 'leans in', Happy: 'little bounce', Focused: 'arms crossed', Frustrated: 'hand on hip', Sleepy: 'slumped', Thinking: 'hand to chin' };
export const DEFAULT_FACES = { Calm: 'neutral', Curious: 'surprised (soft)', Happy: 'happy', Focused: 'neutral + squint', Frustrated: 'angry (soft)', Sleepy: 'relaxed + half blink', Thinking: 'neutral' };

// "surprised (soft)" -> [['surprised', .45]]; "relaxed + half blink" -> [['relaxed',1],['blink',.45]]
export function parseFace(spec) {
  const out = [];
  for (const part of String(spec || 'neutral').split('+')) {
    let p = part.trim().toLowerCase();
    let w = 1;
    if (/\(soft\)/.test(p)) { w = 0.45; p = p.replace('(soft)', '').trim(); }
    if (/^half /.test(p)) { w = 0.45; p = p.replace(/^half /, ''); }
    if (p === 'squint') { out.push(['blink', 0.25]); continue; }
    if (p) out.push([p, w]);
  }
  return out;
}

function lerp(a, b, t) { return a + (b - a) * t; }

// Pose targets for normalized humanoid bones (radians). Arms start in T-pose.
const ARMS_DOWN = { leftUpperArm: [0, 0, -1.25], rightUpperArm: [0, 0, 1.25], leftLowerArm: [0, -0.15, 0], rightLowerArm: [0, 0.15, 0] };
const POSE_BONES = {
  'relaxed stand': Object.assign({}, ARMS_DOWN),
  'leans in': Object.assign({}, ARMS_DOWN, { spine: [0.14, 0, 0], neck: [0.06, 0, 0], head: [0, 0, 0.16] }),
  'little bounce': Object.assign({}, ARMS_DOWN, { leftUpperArm: [0, 0, -1.05], rightUpperArm: [0, 0, 1.05], head: [-0.05, 0, 0.06] }),
  'arms crossed': { leftUpperArm: [0, -0.55, -1.15], rightUpperArm: [0, 0.55, 1.15], leftLowerArm: [0, -2.1, 0], rightLowerArm: [0, 2.1, 0], head: [0.04, 0, 0] },
  'hand on hip': Object.assign({}, ARMS_DOWN, { leftUpperArm: [0, 0.3, -0.95], leftLowerArm: [0, -0.4, -1.45], leftHand: [0, 0, -0.3], spine: [0, 0, 0.05], head: [0, 0, -0.08] }),
  slumped: Object.assign({}, ARMS_DOWN, { spine: [0.18, 0, 0], chest: [0.1, 0, 0], neck: [0.12, 0, 0], head: [0.2, 0, 0.05], leftUpperArm: [0, 0, -1.35], rightUpperArm: [0, 0, 1.35] }),
  'hand to chin': Object.assign({}, ARMS_DOWN, { rightUpperArm: [0, 0.8, 0.8], rightLowerArm: [0, 2.7, 0], rightHand: [0, 0, -0.2], head: [0.06, 0, -0.1] }),
  sit: Object.assign({}, ARMS_DOWN, { leftUpperLeg: [-1.45, 0, 0.05], rightUpperLeg: [-1.45, 0, -0.05], leftLowerLeg: [1.5, 0, 0], rightLowerLeg: [1.5, 0, 0] })
};
const POSE_BONE_NAMES = ['spine', 'chest', 'neck', 'head', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand', 'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg'];
const VISEMES = ['aa', 'ih', 'ou', 'ee', 'oh'];
export const GESTURES = ['wave', 'nod', 'shake head', 'bow', 'stretch', 'spin', 'jump', 'look around'];
export const BODY_POSES = Object.keys(POSE_BONES).concat(['stand']);
const GESTURE_LEN = { wave: 2.4, nod: 1.4, 'shake head': 1.4, bow: 2.2, stretch: 2.6, spin: 2.0, jump: 1.0, 'look around': 3.0 };
// Bone offsets for a gesture at progress p (0..1) and time t.
function gestureBones(g, p, t) {
  const env = Math.sin(Math.min(1, p) * Math.PI); // ease in and out
  switch (g) {
    case 'wave': return { rightUpperArm: [0, 0.2 * env, -2.3 * env], rightLowerArm: [0, 0, 0.45 * Math.sin(t * 12) * env] };
    case 'nod': return { head: [0.28 * Math.sin(p * Math.PI * 4) * env, 0, 0] };
    case 'shake head': return { head: [0, 0.35 * Math.sin(p * Math.PI * 6) * env, 0] };
    case 'bow': return { spine: [0.55 * env, 0, 0], chest: [0.2 * env, 0, 0], head: [0.15 * env, 0, 0] };
    case 'stretch': return { leftUpperArm: [0, 0, 2.5 * env], rightUpperArm: [0, 0, -2.5 * env], spine: [-0.12 * env, 0, 0] };
    case 'look around': return { head: [0, 0.6 * Math.sin(p * Math.PI * 2), 0], neck: [0, 0.2 * Math.sin(p * Math.PI * 2), 0] };
    default: return {};
  }
}

class Base {
  constructor(container, o) {
    this.container = container;
    this.o = Object.assign({ camera: 'full', smooth: true, interactive: true, mood: 'Calm', faces: {}, pose: null }, o || {});
    this.mood = this.o.mood;
    this.speakLevel = 0;
    this.viseme = 'aa';
    this.listening = false;
    this.lookAtUser = false;
    this.t = 0;
    this.destroyed = false;
    this.expressions = [];
    this.onReady = this.o.onReady || (() => {});
    this.onError = this.o.onError || (() => {});
  }
  faceFor(mood) { return (this.o.faces && this.o.faces[mood]) || DEFAULT_FACES[mood] || 'neutral'; }
  setMood(mood, faces) { this.mood = MOODS.includes(mood) ? mood : 'Calm'; if (faces) this.o.faces = faces; }
  setPose(p) { this.o.pose = p; }
  speak(level, viseme) { this.speakLevel = Math.max(0, Math.min(1, level || 0)); if (viseme) this.viseme = viseme; }
  setListening(b) { this.listening = !!b; }
  setLookAtUser(b) { this.lookAtUser = !!b; }
  setSmooth(b) { this.o.smooth = !!b; }
  // Her own choices: a pose and face she picked, and one-off gestures.
  setIntent(intent) {
    const i = intent || null;
    this.intent = i;
    if (i && i.gesture && i.gestureAt && i.gestureAt !== this._gestureAt && GESTURE_LEN[i.gesture]) {
      this._gestureAt = i.gestureAt;
      this.gesture = { name: i.gesture, start: this.t };
    }
  }
  activePose() { return (this.intent && this.intent.pose && this.intent.pose !== 'stand') ? this.intent.pose : this.o.pose || POSES[this.mood] || 'relaxed stand'; }
  activeFace() { return (this.intent && this.intent.face) || this.faceFor(this.mood); }
  gestureNow() {
    if (!this.gesture) return null;
    const p = (this.t - this.gesture.start) / GESTURE_LEN[this.gesture.name];
    if (p >= 1) { this.gesture = null; return null; }
    return { name: this.gesture.name, p };
  }
}

class VrmStage extends Base {
  async load(url) {
    const c = this.container;
    const w = c.clientWidth || 400, h = c.clientHeight || 600;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.o.smooth ? 2 : 1));
    this.renderer.setSize(w, h);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    c.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, w / h, 0.05, 50);
    const key = new THREE.DirectionalLight(0xffffff, Math.PI * 0.9);
    key.position.set(0.8, 1.6, 1.4);
    const fill = new THREE.DirectionalLight(0xc9d6ff, Math.PI * 0.35);
    fill.position.set(-1.2, 1.0, 0.6);
    this.scene.add(key, fill, new THREE.AmbientLight(0xffffff, 0.55));
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.enabled = !!this.o.interactive;
    this.controls.minDistance = 0.3;
    this.controls.maxDistance = 8;

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(url);
    const vrm = gltf.userData.vrm;
    if (!vrm) return this.startPlain(gltf.scene, c);   // 0.6: a plain glTF model (no VRM bones or faces)
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons ? VRMUtils.combineSkeletons(gltf.scene) : null;
    VRMUtils.rotateVRM0(vrm);
    vrm.scene.traverse((o) => { o.frustumCulled = false; });
    this.vrm = vrm;
    this.scene.add(vrm.scene);
    this.lookTarget = new THREE.Object3D();
    this.scene.add(this.lookTarget);
    if (vrm.lookAt) vrm.lookAt.target = this.lookTarget;
    this.expressions = vrm.expressionManager ? Object.keys(vrm.expressionManager.expressionMap || {}).filter((n) => !VISEMES.includes(n) && !/^look|^blink[LR]/.test(n)) : [];
    // Body measurements for camera presets.
    vrm.update(0);
    vrm.scene.updateMatrixWorld(true);
    const bone = (n) => { const b = vrm.humanoid.getRawBoneNode(n) || vrm.humanoid.getNormalizedBoneNode(n); const v = new THREE.Vector3(); if (b) b.getWorldPosition(v); return v; };
    this.headY = bone('head').y || 1.4;
    this.chestY = bone('chest').y || bone('spine').y || 1.1;
    this.hipsY = bone('hips').y || 0.9;
    this.height = this.headY + 0.18;
    this.setCamera(this.o.camera);
    this.poseState = {};
    for (const n of POSE_BONE_NAMES) this.poseState[n] = [0, 0, 0];
    this.blinkAt = 1.5; this.blinkPhase = -1;
    this.clock = new THREE.Timer ? null : new THREE.Clock();
    this.lastT = performance.now();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(c);
    this.loop();
    this.onReady(this);
  }
  // 0.6: a glTF without VRM: stand it on the floor, size the camera to it, and let it breathe and turn.
  startPlain(scene, c) {
    this.plain = scene; this.t = 0;
    this.scene.add(scene);
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
    const h = Math.max(size.y, size.x, 0.01), k = 1.6 / h;
    scene.scale.setScalar(k);
    scene.position.set(-centre.x * k, -box.min.y * k, -centre.z * k);
    this.expressions = [];
    this.height = 1.6; this.headY = 1.42; this.chestY = 1.1; this.hipsY = 0.8;
    this.setCamera(this.o.camera);
    this.lastT = performance.now();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(c);
    this.loop();
    this.onReady(this);
  }
  resize() {
    if (this.destroyed) return;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  setCamera(which) {
    this.o.camera = which || 'full';
    if (!this.vrm && !this.plain) return;
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const presets = {
      full: { y: this.height / 2, span: this.height * 1.12 },
      upper: { y: (this.chestY + this.headY) / 2 + 0.05, span: (this.height - this.hipsY) * 1.05 },
      face: { y: this.headY + 0.06, span: 0.42 }
    };
    const p = presets[this.o.camera] || presets.full;
    const dist = (p.span / 2) / Math.tan(fov / 2);
    this.camera.position.set(0, p.y, dist);
    this.controls.target.set(0, p.y, 0);
    this.controls.update();
    this.home = { pos: this.camera.position.clone(), target: this.controls.target.clone() };
  }
  resetView() { if (this.home) { this.camera.position.copy(this.home.pos); this.controls.target.copy(this.home.target); this.controls.update(); } }
  setPose(p) { this.o.pose = p; }
  loop() {
    if (this.destroyed) return;
    const minFrame = this.o.smooth ? 0 : 1 / 30;
    this.raf = requestAnimationFrame(() => this.loop());
    const now = performance.now();
    const dt = (now - this.lastT) / 1000;
    this.lastT = now;
    this._acc = (this._acc || 0) + dt;
    if (this._acc < minFrame) return;
    const step = this._acc; this._acc = 0;
    this.update(Math.min(step, 0.1));
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
  update(dt) {
    if (this.plain) {
      this.t += dt;
      const s = 1 + 0.012 * Math.sin(this.t * 1.6);
      this.plain.rotation.y = 0.25 * Math.sin(this.t * 0.35);
      this.plain.scale.y = this.plain.scale.x * s;
      return;
    }
    const vrm = this.vrm;
    this.t += dt;
    const t = this.t;
    // Pose: blend toward the mood's posture.
    const poseName = this.activePose();
    const target = POSE_BONES[poseName] || POSE_BONES['relaxed stand'];
    const k = 1 - Math.pow(0.02, dt);
    for (const n of POSE_BONE_NAMES) {
      const goal = target[n] || [0, 0, 0];
      const cur = this.poseState[n];
      for (let i = 0; i < 3; i++) cur[i] = lerp(cur[i], goal[i], k);
      const b = vrm.humanoid.getNormalizedBoneNode(n);
      if (b) b.rotation.set(cur[0], cur[1], cur[2]);
    }
    const g = this.gestureNow();
    if (g) {
      const add = gestureBones(g.name, g.p, t);
      for (const n of Object.keys(add)) {
        const b = vrm.humanoid.getNormalizedBoneNode(n);
        if (b) { b.rotation.x += add[n][0]; b.rotation.y += add[n][1]; b.rotation.z += add[n][2]; }
      }
    }
    // Breathing and idle sway on top of the pose.
    const breathe = Math.sin(t * 1.4) * 0.025;
    const spine = vrm.humanoid.getNormalizedBoneNode('spine');
    if (spine) spine.rotation.x += breathe * 0.5;
    const chest = vrm.humanoid.getNormalizedBoneNode('chest') || vrm.humanoid.getNormalizedBoneNode('upperChest');
    if (chest) chest.rotation.x -= breathe * 0.6;
    const hips = vrm.humanoid.getNormalizedBoneNode('hips');
    if (hips) {
      hips.rotation.z = Math.sin(t * 0.55) * 0.025;
      hips.rotation.y = Math.sin(t * 0.33) * 0.04;
      if (this.hipsBaseY == null) this.hipsBaseY = hips.position.y;
      hips.position.y = this.hipsBaseY + (poseName === 'little bounce' ? Math.abs(Math.sin(t * 3.2)) * 0.025 : 0) + (poseName === 'sit' ? -0.42 : 0) + (g && g.name === 'jump' ? Math.sin(g.p * Math.PI) * 0.18 : 0);
      if (g && g.name === 'spin') hips.rotation.y = g.p * Math.PI * 2;
    }
    const head = vrm.humanoid.getNormalizedBoneNode('head');
    if (head) {
      head.rotation.z += Math.sin(t * 0.7) * 0.03;
      if (this.listening) head.rotation.x += Math.max(0, Math.sin(t * 4.2)) * 0.12;
    }
    // Eyes: at you, or wandering.
    if (this.lookAtUser) this.lookTarget.position.copy(this.camera.position);
    else this.lookTarget.position.set(Math.sin(t * 0.21) * 0.6, this.headY + Math.sin(t * 0.17) * 0.15, 2);
    // Face: mood expression, blink, mouth.
    const em = vrm.expressionManager;
    if (em) {
      const want = {};
      for (const [name, w] of parseFace(this.activeFace())) want[name] = Math.max(want[name] || 0, w);
      for (const name of Object.keys(em.expressionMap || {})) {
        if (VISEMES.includes(name) || name === 'blink') continue;
        const cur = em.getValue(name) || 0;
        em.setValue(name, lerp(cur, want[name] || 0, 1 - Math.pow(0.05, dt)));
      }
      // Blink every few seconds.
      this.blinkAt -= dt;
      if (this.blinkAt <= 0 && this.blinkPhase < 0) this.blinkPhase = 0;
      let blink = want.blink || 0;
      if (this.blinkPhase >= 0) {
        this.blinkPhase += dt / 0.16;
        blink = Math.max(blink, Math.sin(Math.min(1, this.blinkPhase) * Math.PI));
        if (this.blinkPhase >= 1) { this.blinkPhase = -1; this.blinkAt = 2 + Math.random() * 4; }
      }
      em.setValue('blink', blink);
      for (const v of VISEMES) em.setValue(v, v === this.viseme ? this.speakLevel : lerp(em.getValue(v) || 0, 0, 0.5));
    }
    vrm.update(dt);
  }
  snapshot() { try { return this.renderer.domElement.toDataURL('image/png'); } catch (_) { return null; } }
  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    if (this.ro) this.ro.disconnect();
    if (this.vrm) VRMUtils.deepDispose(this.vrm.scene);
    if (this.plain) VRMUtils.deepDispose(this.plain);
    if (this.renderer) { this.renderer.dispose(); this.renderer.domElement.remove(); }
    if (this.controls) this.controls.dispose();
  }
}

let coreLoading = null;
function loadCubismCore(url) {
  if (window.Live2DCubismCore) return Promise.resolve();
  if (!coreLoading) {
    coreLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = () => resolve();
      s.onerror = () => { coreLoading = null; reject(new Error('Couldn’t load the Live2D runtime.')); };
      document.head.appendChild(s);
    });
  }
  return coreLoading;
}

class Live2dStage extends Base {
  async load(url) {
    if (!this.o.coreUrl) throw new Error('The Live2D runtime isn’t downloaded yet.');
    await loadCubismCore(this.o.coreUrl);
    window.PIXI = PIXI;
    const { Live2DModel } = await import('pixi-live2d-display/cubism4');
    Live2DModel.registerTicker(PIXI.Ticker);
    const c = this.container;
    this.app = new PIXI.Application({ backgroundAlpha: 0, antialias: true, resizeTo: c, autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, this.o.smooth ? 2 : 1), preserveDrawingBuffer: true });
    this.app.view.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    c.appendChild(this.app.view);
    const model = await Live2DModel.from(url, { autoInteract: false });
    if (this.destroyed) { model.destroy(); return; }
    this.model = model;
    this.app.stage.addChild(model);
    model.anchor.set(0.5, 0.5);
    const defs = (model.internalModel.motionManager.expressionManager && model.internalModel.motionManager.expressionManager.definitions) || [];
    this.expressions = defs.map((d) => d.Name || d.name).filter(Boolean);
    this.zoom = 1;
    this.setCamera(this.o.camera);
    this.lastExpr = null;
    model.internalModel.on('beforeModelUpdate', () => this.drive());
    if (this.o.interactive) {
      c.addEventListener('pointermove', (this._pm = (e) => { const r = c.getBoundingClientRect(); this.pointer = [e.clientX - r.left, e.clientY - r.top]; }));
      c.addEventListener('wheel', (this._wh = (e) => { e.preventDefault(); this.zoom = Math.max(0.5, Math.min(4, this.zoom * (e.deltaY < 0 ? 1.1 : 0.9))); this.layout(); }), { passive: false });
    }
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(c);
    this.app.ticker.add((d) => { this.t += d / 60; });
    this.onReady(this);
  }
  setCamera(which) { this.o.camera = which || 'full'; this.zoom = 1; this.layout(); }
  resetView() { this.zoom = 1; this.layout(); }
  layout() {
    const m = this.model;
    if (!m) return;
    const W = this.container.clientWidth, H = this.container.clientHeight;
    const iw = m.internalModel.width, ih = m.internalModel.height;
    const cam = { full: { s: 1, fy: 0.5 }, upper: { s: 1.9, fy: 0.3 }, face: { s: 3.4, fy: 0.17 } }[this.o.camera] || { s: 1, fy: 0.5 };
    const base = Math.min(W / iw, H / ih) * 0.95;
    const s = base * cam.s * this.zoom;
    m.scale.set(s);
    m.position.set(W / 2, H / 2 + (0.5 - cam.fy) * ih * s);
    this._baseY = m.y;
  }
  drive() {
    const m = this.model;
    const core = m.internalModel.coreModel;
    const set = (id, v) => { try { core.setParameterValueById(id, v); } catch (_) {} };
    const t = this.t;
    // Expression for the mood.
    const face = parseFace(this.activeFace())[0];
    const name = face && this.expressions.find((e) => e.toLowerCase() === face[0]);
    if (name && name !== this.lastExpr) { m.expression(name); this.lastExpr = name; }
    // Posture from mood.
    const pose = this.activePose();
    const g = this.gestureNow();
    const gp = g ? Math.sin(g.p * Math.PI) : 0;
    const lean = { 'leans in': 8, slumped: -6, 'hand to chin': 3 }[pose] || 0;
    const tilt = { 'leans in': 10, 'hand on hip': -8, 'hand to chin': -12, slumped: 6 }[pose] || 0;
    set('ParamBodyAngleX', Math.sin(t * 0.5) * 3 + (pose === 'little bounce' ? Math.sin(t * 6) * 4 : 0));
    set('ParamBodyAngleZ', Math.sin(t * 0.4) * 2 + tilt * 0.4);
    set('ParamAngleZ', tilt + Math.sin(t * 0.7) * 2);
    set('ParamAngleY', lean + (this.listening ? Math.max(0, Math.sin(t * 4.2)) * 14 : 0) + (pose === 'slumped' ? -12 : 0) + (g && g.name === 'nod' ? Math.sin(g.p * Math.PI * 4) * 20 * gp : 0) + (g && g.name === 'bow' ? -25 * gp : 0));
    if (g && (g.name === 'shake head' || g.name === 'look around')) set('ParamAngleX', Math.sin(g.p * Math.PI * (g.name === 'look around' ? 2 : 6)) * 28 * (g.name === 'look around' ? 1 : gp));
    if (g && g.name === 'jump') m.y = this._baseY - Math.sin(g.p * Math.PI) * 40;
    if (g && (g.name === 'wave' || g.name === 'stretch') && !this._motioned) { this._motioned = true; try { m.motion(g.name === 'wave' ? 'TapBody' : 'Idle'); } catch (_) {} }
    if (!g) this._motioned = false;
    set('ParamBreath', (Math.sin(t * 1.4) + 1) / 2);
    // Eyes and head toward you or the pointer.
    if (this.lookAtUser) m.focus(this.container.clientWidth / 2, this.container.clientHeight * 0.3);
    else if (this.pointer) m.focus(this.pointer[0], this.pointer[1]);
    // Mouth follows her voice.
    const form = { aa: 0.3, ih: 1, ou: -0.6, ee: 0.8, oh: -0.3 }[this.viseme] || 0;
    if (this.speakLevel > 0.02) { set('ParamMouthOpenY', this.speakLevel); set('ParamMouthForm', form); }
    if (pose === 'slumped' || /half blink/.test(this.activeFace())) { set('ParamEyeLOpen', 0.55); set('ParamEyeROpen', 0.55); }
  }
  snapshot() { try { this.app.renderer.render(this.app.stage); return this.app.view.toDataURL('image/png'); } catch (_) { return null; } }
  destroy() {
    this.destroyed = true;
    if (this.ro) this.ro.disconnect();
    if (this._pm) this.container.removeEventListener('pointermove', this._pm);
    if (this._wh) this.container.removeEventListener('wheel', this._wh);
    if (this.app) { this.app.destroy(true, { children: true }); }
  }
}

export async function create(container, o) {
  const stage = o.kind === 'live2d' ? new Live2dStage(container, o) : new VrmStage(container, o);
  try { await stage.load(o.url); } catch (e) { stage.destroy(); throw e; }
  return stage;
}

// Rough mouth shape from the sound: low energy-weighted frequency -> o/u,
// high -> i/e, middle -> a.
export function visemeFromSpectrum(freqData) {
  let lo = 0, mid = 0, hi = 0;
  const n = freqData.length;
  for (let i = 0; i < n; i++) {
    const v = freqData[i];
    if (i < n * 0.06) lo += v; else if (i < n * 0.16) mid += v; else if (i < n * 0.4) hi += v;
  }
  const tot = lo + mid + hi || 1;
  if (hi / tot > 0.42) return hi / tot > 0.5 ? 'ih' : 'ee';
  if (lo / tot > 0.55) return lo / tot > 0.65 ? 'ou' : 'oh';
  return 'aa';
}

export { MOODS };
