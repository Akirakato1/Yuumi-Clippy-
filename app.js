// app.js — Yuumi physics drag demo
// Idle: <skin>_yuumi_idle.glb | Drag: <skin>_yuumi_drag.glb

let currentSkin        = 'edg';
let renderLoopRunning  = false;
let normalizeFrames    = 0;   // re-apply material fix for first N frames after load

// ─── Basis pose times (Dance_Loop) ───────────────────────────────────────────
const POSE = {
  neutral: 2.767,
  right:   2.833,
  left:    3.400,
  down:    2.533,
};
const BLEND_SCALE = { horizontal: 130, vertical: 110 };

const BOOK_NATIVE_Y  = 172.4;
const FADE_DURATION  = 0.35;

// ─── Pivot free-flight tuning ─────────────────────────────────────────────────
const PIVOT_FRICTION    = 1.2;  // drag (1/s) — higher = stops faster, 0 = no friction
const PIVOT_BOUNCE      = 0.55; // wall restitution — 0 = dead stop, 1 = perfect bounce
const FOLLOW_DEAD_ZONE  = 80;   // px at 100% size — scales with modelSizeScale

// ─── Base orientation — tweak these to taste ──────────────────────────────────
const IDLE_BASE_X   = THREE_DEG(24);    // idle: tilt down
const IDLE_BASE_Y   = THREE_DEG(0);
const GRAB_BASE_X   = THREE_DEG(-25);   // grabbed: more tilt down
const GRAB_BASE_Y   = THREE_DEG(30);

function THREE_DEG(d) { return d * Math.PI / 180; }

// ─── Secondary motion ─────────────────────────────────────────────────────────
const SECONDARY_BONES = [
  { name: 'Spine',      lateralAxis: 'z', verticalAxis: 'x', lateralScale: 0.04, verticalScale: 0.03, k: 12, damp: 5,   maxDeg: 25 },
  { name: 'Neck',       lateralAxis: 'z', verticalAxis: 'x', lateralScale: 0.07, verticalScale: 0.05, k: 10, damp: 4,   maxDeg: 35 },
  { name: 'Head',       lateralAxis: 'z', verticalAxis: null, lateralScale: 0.09, verticalScale: 0,   k: 8,  damp: 3.5, maxDeg: 30 },
  { name: 'L_Shoulder', lateralAxis: 'z', verticalAxis: 'x', lateralScale: 0.12, verticalScale: 0.08, k: 6,  damp: 3,   maxDeg: 45 },
  { name: 'R_Shoulder', lateralAxis: 'z', verticalAxis: 'x', lateralScale: 0.12, verticalScale: 0.08, k: 6,  damp: 3,   maxDeg: 45 },
  { name: 'L_Hand',     lateralAxis: 'z', verticalAxis: 'x', lateralScale: 0.18, verticalScale: 0.12, k: 5,  damp: 2.5, maxDeg: 60 },
  { name: 'R_Hand',     lateralAxis: 'z', verticalAxis: 'x', lateralScale: 0.18, verticalScale: 0.12, k: 5,  damp: 2.5, maxDeg: 60 },
  { name: 'L_Hip',      lateralAxis: 'z', verticalAxis: 'x', lateralScale: 0.10, verticalScale: 0.07, k: 7,  damp: 3.5, maxDeg: 40 },
  { name: 'R_Hip',      lateralAxis: 'z', verticalAxis: 'x', lateralScale: 0.10, verticalScale: 0.07, k: 7,  damp: 3.5, maxDeg: 40 },
  { name: 'L_Foot',     lateralAxis: 'z', verticalAxis: 'x', lateralScale: 0.16, verticalScale: 0.10, k: 5,  damp: 2.5, maxDeg: 55 },
  { name: 'R_Foot',     lateralAxis: 'z', verticalAxis: 'x', lateralScale: 0.16, verticalScale: 0.10, k: 5,  damp: 2.5, maxDeg: 55 },
];

const TAIL_BONES       = ['Tail1','Tail2','Tail3','Tail4','Tail5','Tail6'];
const TAIL_REST_Z      = [80, 10, 10, 15, 0, -25];
const TAIL_SWING_SCALE = [0.3, 0.5, 0.8, 1.1, 1.4, 1.8];

// ─── Spring state ─────────────────────────────────────────────────────────────
let bodyAccelX = 0, bodyAccelY = 0;
let prevPivotVX = 0, prevPivotVY = 0;
let prevPivotX  = 0, prevPivotY  = 0;
let freePivotVX = 0, freePivotVY = 0;
const JERK_THRESHOLD = 40; // px/s — minimum speed at which a direction flip triggers a yelp

const boneSpringState = {};
SECONDARY_BONES.forEach(b => {
  boneSpringState[b.name] = { lat: 0, latV: 0, vert: 0, vertV: 0 };
});

const tailSpring = { angle: 0, vel: 0, k: 8, damp: 3.5 };


// ─── Three.js globals ─────────────────────────────────────────────────────────
let renderer, scene, camera;
let yuumiRoot  = null;
let modelScale = 1;
const boneMap  = {};

let idleMixer,  idleAction,  idleClipDuration  = 1;
let danceMixer, danceAction, danceClipDuration = 4.667;

// ─── Animation state machine ──────────────────────────────────────────────────
// danceWeight: 0 = full idle, 1 = full dance
let danceWeight = 0;
let prevGrabbed = false;

// ─── App state ────────────────────────────────────────────────────────────────
let grabbed     = false;
let grabOffsetX = 0, grabOffsetY = 0;
let prevTs      = null;
let followCursor = false;
let cursorX = window.innerWidth / 2, cursorY = window.innerHeight / 2;
let smoothFollowYaw   = 0; // radians — smoothed yaw offset while following
let smoothFollowPitch = 0; // radians — smoothed pitch offset while following

// Screen-space bounding box rebuilt every frame from animated bone positions
let yuumiScreenBounds = null;

// Bones sampled to build the hitbox (covers head→hips + shoulder width + book anchor)
const HITBOX_BONES = ['Head', 'Neck', 'Spine', 'L_Shoulder', 'R_Shoulder', 'L_Hand', 'R_Hand', 'L_Hip', 'R_Hip'];
const HITBOX_PAD   = 12; // px of extra margin around the bounding box

function updateHitbox() {
  if (!yuumiRoot || !camera) return;
  const W = window.innerWidth, H = window.innerHeight;

  // Start with the physics pivot (book anchor) which is always accurate
  let minX = Physics.state.pivotX, maxX = Physics.state.pivotX;
  let minY = Physics.state.pivotY, maxY = Physics.state.pivotY;

  HITBOX_BONES.forEach(name => {
    const bone = boneMap[name];
    if (!bone) return;
    bone.getWorldPosition(_boneWorld);
    _boneWorld.project(camera);
    const sx = (_boneWorld.x + 1) / 2 * W;
    const sy = (1 - _boneWorld.y) / 2 * H;
    if (sx < minX) minX = sx; if (sx > maxX) maxX = sx;
    if (sy < minY) minY = sy; if (sy > maxY) maxY = sy;
  });

  yuumiScreenBounds = {
    minX: minX - HITBOX_PAD, minY: minY - HITBOX_PAD,
    maxX: maxX + HITBOX_PAD, maxY: maxY + HITBOX_PAD,
  };
}

// ─── Init ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const wrap = document.getElementById('canvas-wrap');
  const W = window.innerWidth, H = window.innerHeight;

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(W, H);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  wrap.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(18, W / H, 1, 5000);
  camera.position.set(0, 0, 950);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xc0a0ff, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 1.3);
  key.position.set(120, 300, 250); key.castShadow = true; scene.add(key);
  const fill = new THREE.DirectionalLight(0x8060ff, 0.45);
  fill.position.set(-150, 100, 100); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffe0ff, 0.3);
  rim.position.set(0, -120, -200); scene.add(rim);

  Physics.init(W / 2, H * 0.25);
  prevPivotX = W / 2;
  prevPivotY = H * 0.25;

  setupInput(wrap);
  initSettings();
  loadConfig(); // async: reads saved settings and applies them (including initial skin)

  window.addEventListener('resize', () => {
    const W2 = window.innerWidth, H2 = window.innerHeight;
    camera.aspect = W2 / H2;
    camera.updateProjectionMatrix();
    renderer.setSize(W2, H2);
  });
});

// ─── Skin swap ────────────────────────────────────────────────────────────────
function loadSkin(skin) {
  currentSkin = skin;

  // Tear down existing model
  if (yuumiRoot) { scene.remove(yuumiRoot); yuumiRoot = null; }
  if (idleMixer)  { idleMixer.stopAllAction();  idleMixer  = null; idleAction  = null; }
  if (danceMixer) { danceMixer.stopAllAction(); danceMixer = null; danceAction = null; }
  Object.keys(boneMap).forEach(k => delete boneMap[k]);
  yuumiScreenBounds = null;
  normalizeFrames   = 0;

  loadModels(skin);
}

// ─── Load both GLBs ───────────────────────────────────────────────────────────
function loadModels(skin = 'default') {
  const glbDance = `yuumi_models/${skin}_yuumi_drag.glb`;
  const glbIdle  = `yuumi_models/${skin}_yuumi_idle.glb`;

  setStatus('Loading model…');
  const loader = new THREE.GLTFLoader();

  loader.load(glbDance,
    (gltf) => {
      setStatus('Loading idle animation…');
      setProgress(50);

      yuumiRoot = gltf.scene;
      scene.add(yuumiRoot);

      // Compute modelScale only once from the first loaded model so all skins
      // render at the same size regardless of their bind-pose bounding box.
      if (modelScale === 1) {
        const box  = new THREE.Box3().setFromObject(yuumiRoot);
        const size = box.getSize(new THREE.Vector3());
        if (size.y > 0) modelScale = screenHeightToWorld(window.innerHeight * 0.45) / size.y;
      }
      yuumiRoot.scale.setScalar(modelScale * modelSizeScale);

      yuumiRoot.traverse((obj) => { if (obj.name) boneMap[obj.name] = obj; });
      console.log('[Yuumi bones]', Object.keys(boneMap).sort().join(', '));
      normalizeMaterialOpacity();

      // Dance mixer — weight starts at 0 (hidden), scrubbed by physics
      if (gltf.animations.length > 0) {
        danceClipDuration = gltf.animations[0].duration;
        danceMixer  = new THREE.AnimationMixer(yuumiRoot);
        danceAction = danceMixer.clipAction(gltf.animations[0]);
        danceAction.loop = THREE.LoopRepeat;
        danceAction.play();
        danceAction.weight = 0;
        scrubDance(POSE.neutral);
      }

      // Load idle clip and retarget onto same skeleton
      loader.load(glbIdle,
        (idleGltf) => {
          setProgress(100);
          if (idleGltf.animations.length > 0) {
            idleClipDuration = idleGltf.animations[0].duration;
            idleMixer  = new THREE.AnimationMixer(yuumiRoot);
            idleAction = idleMixer.clipAction(idleGltf.animations[0]);
            idleAction.loop = THREE.LoopRepeat;
            idleAction.play();
            idleAction.weight = 1;
          }
          normalizeMaterialOpacity();
          if (!renderLoopRunning) { renderLoopRunning = true; hideOverlay(); requestAnimationFrame(renderLoop); }
        },
        (xhr) => { if (xhr.total) setProgress(50 + xhr.loaded / xhr.total * 50); },
        (err) => {
          // Fallback: reuse dance clip for idle
          console.warn(`${glbIdle} not found, falling back to drag clip for idle.`, err);
          idleMixer        = danceMixer;
          idleAction       = danceAction;
          idleClipDuration = danceClipDuration;
          idleAction.weight = 1;
          normalizeMaterialOpacity();
          if (!renderLoopRunning) { renderLoopRunning = true; hideOverlay(); requestAnimationFrame(renderLoop); }
        }
      );
    },
    (xhr) => { if (xhr.total) setProgress(xhr.loaded / xhr.total * 50); },
    (err) => { console.error(err); showErr(`Could not load ${glbDance}\n\nRun: python -m http.server 8080`); }
  );
}

function hideOverlay() {
  setTimeout(() => {
    const ov = document.getElementById('overlay');
    if (!ov) return;
    ov.classList.add('hidden');
    setTimeout(() => ov.remove(), 700);
  }, 200);
}

// ─── Scrub dance clip to specific time ───────────────────────────────────────
function scrubDance(t) {
  if (!danceMixer || !danceAction) return;
  danceAction.time = ((t % danceClipDuration) + danceClipDuration) % danceClipDuration;
  danceMixer.update(0);
}

// Scratch objects — allocated once, reused every frame to avoid GC pressure
const _s2wNdc    = new THREE.Vector3();         // screenToWorld: NDC point / result
const _s2wDir    = new THREE.Vector3();         // screenToWorld: ray direction
const _boneWorld = new THREE.Vector3();         // updateHitbox: bone world position

// ─── Render Loop ──────────────────────────────────────────────────────────────
function renderLoop(ts) {
  requestAnimationFrame(renderLoop);
  const dt = prevTs ? Math.min((ts - prevTs) / 1000, 0.05) : 0.016;
  prevTs = ts;

  // Re-apply material normalization for the first 10 frames after each load
  // in case the GLTFLoader finalises texture uploads asynchronously and
  // resets transparency flags after our initial normalizeMaterialOpacity call.
  if (normalizeFrames < 10) { normalizeMaterialOpacity(); normalizeFrames++; }

  const W = window.innerWidth, H = window.innerHeight;

  // Yuumi's visual center in screen space (from previous frame's bone bounds).
  // Used by follow-cursor for both movement target and face-align reference.
  const yuumiCenterX = yuumiScreenBounds
    ? (yuumiScreenBounds.minX + yuumiScreenBounds.maxX) / 2
    : Physics.state.pivotX;
  const yuumiCenterY = yuumiScreenBounds
    ? (yuumiScreenBounds.minY + yuumiScreenBounds.maxY) / 2
    : Physics.state.pivotY;
  // Vector from Yuumi's center to cursor — moving pivot by this brings center onto cursor
  const followDcx = cursorX - yuumiCenterX;
  const followDcy = cursorY - yuumiCenterY;
  const followDist = Math.hypot(followDcx, followDcy);

  // ── Crossfade weight ───────────────────────────────────────────────────────
  // Slide danceWeight toward 1 when grabbed, toward 0 when released.
  const fadeSpeed = 1 / FADE_DURATION;
  if (grabbed) {
    danceWeight = Math.min(1, danceWeight + fadeSpeed * dt);
  } else {
    danceWeight = Math.max(0, danceWeight - fadeSpeed * dt);
  }
  prevGrabbed = grabbed;

  // ── Pivot free-flight ──────────────────────────────────────────────────────
  if (!grabbed) {
    if (followCursor) {
      // Move pivot so Yuumi's visual center reaches the cursor.
      // followDcx/y is center→cursor, so adding it to pivot brings center onto cursor.
      if (followDist > 2) {
        const speed = Math.min(followDist * 3, 180); // px/s; decelerates near cursor
        const move  = speed * dt;
        Physics.state.pivotX += (followDcx / followDist) * move;
        Physics.state.pivotY += (followDcy / followDist) * move;
        freePivotVX = (followDcx / followDist) * speed;
        freePivotVY = (followDcy / followDist) * speed;
      } else {
        freePivotVX = 0;
        freePivotVY = 0;
      }
    } else {
      // Friction drag + inertia
      const drag = Math.exp(-PIVOT_FRICTION * dt);
      freePivotVX *= drag;
      freePivotVY *= drag;
      Physics.state.pivotX += freePivotVX * dt;
      Physics.state.pivotY += freePivotVY * dt;
    }

    // Wall bounce — use actual model visual bounds so edges align with screen
    // Top wall: pivot IS the book — always the topmost visible element.
    // Using b.minY is unreliable because perspective + tilt can project arm/hand
    // bones above the book, creating a false wall far down the screen.
    if (Physics.state.pivotY < HITBOX_PAD) {
      Physics.state.pivotY = HITBOX_PAD;
      freePivotVY = Math.abs(freePivotVY) * PIVOT_BOUNCE;
      playYelp();
    }
    if (yuumiScreenBounds) {
      const b = yuumiScreenBounds;
      const e = HITBOX_PAD;
      if (b.minX + e < 0) { Physics.state.pivotX -= (b.minX + e);     freePivotVX =  Math.abs(freePivotVX) * PIVOT_BOUNCE; playYelp(); }
      if (b.maxX - e > W) { Physics.state.pivotX -= (b.maxX - e - W); freePivotVX = -Math.abs(freePivotVX) * PIVOT_BOUNCE; playYelp(); }
      if (b.maxY - e > H) { Physics.state.pivotY -= (b.maxY - e - H); freePivotVY = -Math.abs(freePivotVY) * PIVOT_BOUNCE; playYelp(); }
    } else {
      if (Physics.state.pivotX < 60)     { Physics.state.pivotX = 60;      freePivotVX =  Math.abs(freePivotVX) * PIVOT_BOUNCE; playYelp(); }
      if (Physics.state.pivotX > W - 60) { Physics.state.pivotX = W - 60;  freePivotVX = -Math.abs(freePivotVX) * PIVOT_BOUNCE; playYelp(); }
      if (Physics.state.pivotY > H - 100){ Physics.state.pivotY = H - 100; freePivotVY = -Math.abs(freePivotVY) * PIVOT_BOUNCE; playYelp(); }
    }
  } else {
    // Inherit throw velocity on release
    freePivotVX = (Physics.state.pivotX - prevPivotX) / dt;
    freePivotVY = (Physics.state.pivotY - prevPivotY) / dt;
  }
  Physics.step(dt);

  const disp  = Physics.displacement();
  const speed = Physics.speed();

  // ── Body acceleration ──────────────────────────────────────────────────────
  const pivotVX   = (Physics.state.pivotX - prevPivotX) / dt;
  const pivotVY   = (Physics.state.pivotY - prevPivotY) / dt;
  bodyAccelX += ((pivotVX - prevPivotVX)/dt - bodyAccelX) * Math.min(1, dt * 8);
  bodyAccelY += ((pivotVY - prevPivotVY)/dt - bodyAccelY) * Math.min(1, dt * 8);

  // Jerk: fast direction reversal while dragging
  if (grabbed &&
      Math.abs(pivotVX) > JERK_THRESHOLD &&
      prevPivotVX !== 0 &&
      Math.sign(pivotVX) !== Math.sign(prevPivotVX)) {
    playYelp();
  }

  prevPivotVX = pivotVX; prevPivotVY = pivotVY;
  prevPivotX  = Physics.state.pivotX; prevPivotY = Physics.state.pivotY;

  const effectiveAccelX = bodyAccelX * 0.6 + disp.x * 1.2;
  const effectiveAccelY = bodyAccelY * 0.4 + disp.y * 0.8;

  // ── Tail spring ────────────────────────────────────────────────────────────
  const tailTarget = -(pivotVX * 0.18) - (disp.x * 0.25);
  tailSpring.vel   += (-tailSpring.k * (tailSpring.angle - tailTarget) - tailSpring.damp * tailSpring.vel) * dt;
  tailSpring.angle += tailSpring.vel * dt;
  tailSpring.angle  = Math.max(-90, Math.min(90, tailSpring.angle));

  // ── Drive both mixers ──────────────────────────────────────────────────────
  // Idle: tick forward normally
  if (idleMixer && idleAction) {
    idleAction.weight = 1 - danceWeight;
    idleMixer.update(dt);
  }

  // Dance: scrub to physics-blended time
  if (danceMixer && danceAction) {
    danceAction.weight = danceWeight;
    scrubDance(blendedAnimTime(disp));
  }

  // ── Secondary motion (runs after both mixers, overrides result) ───────────
  SECONDARY_BONES.forEach(def => {
    const bone  = boneMap[def.name];
    if (!bone) return;
    const state = boneSpringState[def.name];

    const latAcc = -def.k * (state.lat - (-effectiveAccelX * def.lateralScale)) - def.damp * state.latV;
    state.latV += latAcc * dt;
    state.lat  += state.latV * dt;
    state.lat   = Math.max(-def.maxDeg, Math.min(def.maxDeg, state.lat));
    bone.rotation[def.lateralAxis] += THREE.MathUtils.degToRad(state.lat) * danceWeight;

    if (def.verticalAxis) {
      const vertAcc = -def.k * (state.vert - (effectiveAccelY * def.verticalScale)) - def.damp * state.vertV;
      state.vertV += vertAcc * dt;
      state.vert  += state.vertV * dt;
      state.vert   = Math.max(-def.maxDeg, Math.min(def.maxDeg, state.vert));
      bone.rotation[def.verticalAxis] += THREE.MathUtils.degToRad(state.vert) * danceWeight;
    }
  });

  // ── Tail override ──────────────────────────────────────────────────────────
  TAIL_BONES.forEach((name, i) => {
    const bone = boneMap[name];
    if (!bone) return;
    bone.rotation.z = THREE.MathUtils.degToRad(TAIL_REST_Z[i] + tailSpring.angle * TAIL_SWING_SCALE[i] * danceWeight);
  });

  // ── Position + orientation ─────────────────────────────────────────────────
  if (yuumiRoot) {
    const pivotW = screenToWorld(Physics.state.pivotX, Physics.state.pivotY);
    yuumiRoot.position.set(pivotW.x, pivotW.y - BOOK_NATIVE_Y * modelScale * modelSizeScale, 0);

    // Interpolate base angles between idle and grabbed
    const baseX = IDLE_BASE_X + (GRAB_BASE_X - IDLE_BASE_X) * danceWeight;
    const baseY = IDLE_BASE_Y + (GRAB_BASE_Y - IDLE_BASE_Y) * danceWeight;

    // Follow mode: align face normal to Yuumi-center → cursor direction.
    // Inside FOLLOW_DEAD_ZONE (cursor overlapping Yuumi) → return to idle pose.
    if (followCursor && !grabbed && followDist > FOLLOW_DEAD_ZONE * modelSizeScale) {
      const nx = followDcx / followDist;
      const ny = followDcy / followDist;
      const f  = Math.min(1, dt * 5);
      smoothFollowYaw   += (Math.asin(nx) - smoothFollowYaw)   * f;
      smoothFollowPitch += (Math.asin(ny) - smoothFollowPitch) * f;
    } else {
      const f = Math.min(1, dt * (followCursor ? 5 : 6));
      smoothFollowYaw   -= smoothFollowYaw   * f;
      smoothFollowPitch -= smoothFollowPitch * f;
    }

    const tiltZ = -Math.atan2(disp.x, Math.max(20, Physics.state.restOffsetY - disp.y)) * 0.65;
    const tiltX =  Math.atan2(disp.y, Physics.state.restOffsetY) * 0.2;
    yuumiRoot.rotation.set(
      tiltX + baseX + smoothFollowPitch,
      baseY + smoothFollowYaw,
      tiltZ
    );
  }

  updateHitbox();
  renderer.render(scene, camera);
}

// ─── Pose Blending ────────────────────────────────────────────────────────────
function blendedAnimTime(disp) {
  const wRight   = Math.max(0,  disp.x / BLEND_SCALE.horizontal);
  const wLeft    = Math.max(0, -disp.x / BLEND_SCALE.horizontal);
  const wDown    = Math.max(0,  disp.y / BLEND_SCALE.vertical);
  const wNeutral = Math.max(0, 1 - (wRight + wLeft + wDown));
  const total    = wNeutral + wRight + wLeft + wDown;
  const n        = total < 1e-6 ? 1 : total;
  return (POSE.neutral*(wNeutral/n) + POSE.right*(wRight/n) + POSE.left*(wLeft/n) + POSE.down*(wDown/n));
}

// ─── Coordinate Helpers ───────────────────────────────────────────────────────
// Returns _s2wNdc (scratch) — caller must consume before next call to screenToWorld.
function screenToWorld(sx, sy) {
  const W = window.innerWidth, H = window.innerHeight;
  _s2wNdc.set((sx/W)*2-1, -(sy/H)*2+1, 0.5).unproject(camera);
  _s2wDir.subVectors(_s2wNdc, camera.position).normalize();
  const t = -camera.position.z / _s2wDir.z;
  _s2wNdc.set(
    camera.position.x + _s2wDir.x * t,
    camera.position.y + _s2wDir.y * t,
    0
  );
  return _s2wNdc;
}
function screenHeightToWorld(px) {
  return (px / window.innerHeight) * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov)/2) * camera.position.z;
}

// ─── Quotes ───────────────────────────────────────────────────────────────────
// Flat list built from JSON: { text, audioSrc }
let yuumiQuotes = [];

fetch('yuumi_quotes.json')
  .then(r => r.json())
  .then(data => {
    for (const category in data) {
      for (const subcategory in data[category]) {
        data[category][subcategory].forEach((text, index) => {
          yuumiQuotes.push({
            text,
            audioSrc: `yuumi_quotes_audio/${category}__${subcategory}__${index}.ogg`,
          });
        });
      }
    }
  });

// ─── Audio ────────────────────────────────────────────────────────────────────
let currentAudio   = null;
let quoteVolume    = 1.0;
let yelpVolume     = 1.0;
let modelSizeScale = 1.0;
let modelOpacity   = 1.0;

function applyOpacity(opacity) {
  renderer.domElement.style.opacity = opacity;
}

// Reset any baked-in material opacity so the model is fully opaque at load.
// The user-facing opacity slider works at the CSS canvas level, so material
// opacity values inside the GLB should always be 1.
function normalizeMaterialOpacity() {
  if (!yuumiRoot) return;
  yuumiRoot.traverse(obj => {
    // Catch Mesh, Points (particles/sparkles), and Line objects
    if (!obj.isMesh && !obj.isPoints && !obj.isLine) return;
    if (!obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach(m => {
      m.transparent = false;
      m.opacity      = 1;
      m.depthWrite   = true;
      m.alphaTest    = 0;
      m.needsUpdate  = true;
    });
  });
}

// ─── Yelp sounds ─────────────────────────────────────────────────────────────
const YELP_SRCS     = ['yuumi_quotes_audio/yelp1.ogg', 'yuumi_quotes_audio/yelp2.ogg'];
const YELP_COOLDOWN = 0.8;
let   yelpsLastTime = 0;

function playYelp(bypassCooldown = false) {
  const now = performance.now() / 1000;
  if (!bypassCooldown && now - yelpsLastTime < YELP_COOLDOWN) return;
  yelpsLastTime = now;
  const audio = new Audio(YELP_SRCS[Math.floor(Math.random() * YELP_SRCS.length)]);
  audio.volume = yelpVolume;
  audio.play().catch(() => {});
}

// ─── Settings panel ───────────────────────────────────────────────────────────
function initSettings() {
  const panel    = document.getElementById('settings-panel');
  const sliderQ  = document.getElementById('vol-quote');
  const sliderY  = document.getElementById('vol-yelp');
  const valQ     = document.getElementById('vol-quote-val');
  const valY     = document.getElementById('vol-yelp-val');

  document.getElementById('settings-close').addEventListener('click', hideSettings);


  document.querySelectorAll('.skin-btn[data-skin]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.skin-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadSkin(btn.dataset.skin);
    });
  });

  const sliderO  = document.getElementById('opacity-scale');
  const valO     = document.getElementById('opacity-scale-val');
  sliderO.addEventListener('input', () => {
    modelOpacity = sliderO.value / 100;
    valO.textContent = sliderO.value + '%';
    applyOpacity(modelOpacity);
  });

  const sliderS  = document.getElementById('size-scale');
  const valS     = document.getElementById('size-scale-val');
  sliderS.addEventListener('input', () => {
    modelSizeScale = sliderS.value / 100;
    valS.textContent = sliderS.value + '%';
    if (yuumiRoot) yuumiRoot.scale.setScalar(modelScale * modelSizeScale);
  });

  sliderQ.addEventListener('input', () => {
    quoteVolume = sliderQ.value / 100;
    valQ.textContent = sliderQ.value + '%';
    if (currentAudio) currentAudio.volume = quoteVolume;
  });
  sliderY.addEventListener('input', () => {
    yelpVolume = sliderY.value / 100;
    valY.textContent = sliderY.value + '%';
  });

  document.getElementById('quit-btn').addEventListener('click', () => {
    saveConfig();
    if (window.electronAPI) window.electronAPI.quitApp();
  });

  const followBtn = document.getElementById('follow-toggle');
  followBtn.addEventListener('click', () => {
    followCursor = !followCursor;
    followBtn.textContent = followCursor ? 'On' : 'Off';
    followBtn.classList.toggle('active', followCursor);
    if (!followCursor) { freePivotVX = 0; freePivotVY = 0; } // shed follow velocity
  });

  // Close when clicking outside the panel
  window.addEventListener('mousedown', (e) => {
    if (!panel.contains(e.target)) hideSettings();
  }, true);
}

function showSettings() {
  const panel = document.getElementById('settings-panel');
  const W = window.innerWidth, H = window.innerHeight;
  const PAD = 12;

  panel.style.display = 'block';
  const pw = panel.offsetWidth, ph = panel.offsetHeight;

  let x = Physics.state.pivotX + 20;
  let y = Physics.state.pivotY - ph / 2;
  if (x + pw > W - PAD) x = Physics.state.pivotX - pw - 20;
  x = Math.max(PAD, Math.min(W - pw - PAD, x));
  y = Math.max(PAD, Math.min(H - ph - PAD, y));

  panel.style.left = x + 'px';
  panel.style.top  = y + 'px';
}

function hideSettings() {
  document.getElementById('settings-panel').style.display = 'none';
  saveConfig();
}

function saveConfig() {
  if (!window.electronAPI) return;
  window.electronAPI.writeConfig({
    quoteVolume:    quoteVolume,
    yelpVolume:     yelpVolume,
    sizeScale:      modelSizeScale,
    opacity:        modelOpacity,
    skin:           currentSkin,
    followCursor:   followCursor,
  });
}

async function loadConfig() {
  const cfg = window.electronAPI ? await window.electronAPI.readConfig() : null;

  // Apply saved skin first (avoids a redundant default load)
  const skin = cfg?.skin ?? 'edg';
  loadSkin(skin);
  document.querySelectorAll('.skin-btn[data-skin]').forEach(b => {
    b.classList.toggle('active', b.dataset.skin === skin);
  });

  if (cfg === null) return; // no saved config — rest stays at defaults

  // Volume
  quoteVolume = cfg.quoteVolume ?? 1;
  yelpVolume  = cfg.yelpVolume  ?? 1;
  _applySlider('vol-quote', 'vol-quote-val', quoteVolume * 100);
  _applySlider('vol-yelp',  'vol-yelp-val',  yelpVolume  * 100);

  // Size
  modelSizeScale = cfg.sizeScale ?? 1;
  _applySlider('size-scale', 'size-scale-val', modelSizeScale * 100);

  // Opacity
  modelOpacity = cfg.opacity ?? 1;
  _applySlider('opacity-scale', 'opacity-scale-val', modelOpacity * 100);
  applyOpacity(modelOpacity);

  // Follow cursor toggle
  followCursor = cfg.followCursor ?? false;
  const followBtn = document.getElementById('follow-toggle');
  if (followBtn) {
    followBtn.textContent = followCursor ? 'On' : 'Off';
    followBtn.classList.toggle('active', followCursor);
  }
}

// Helper: set slider value and display label without firing input events
function _applySlider(sliderId, labelId, value) {
  const s = document.getElementById(sliderId);
  const l = document.getElementById(labelId);
  if (s) s.value = value;
  if (l) l.textContent = Math.round(value) + '%';
}

function playQuoteAudio(src) {
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  const audio = new Audio(src);
  audio.volume = quoteVolume;
  currentAudio = audio;
  audio.play().catch(() => {});
  audio.addEventListener('ended', () => {
    if (currentAudio === audio) currentAudio = null;
  });
}

// ─── Click handler ────────────────────────────────────────────────────────────
function onYuumiClick() {
  if (!yuumiQuotes.length) return;
  const quote = yuumiQuotes[Math.floor(Math.random() * yuumiQuotes.length)];
  showSpeechBubble(quote.text);
  playQuoteAudio(quote.audioSrc);
}

function showSpeechBubble(text) {
  // Remove any existing bubble
  document.querySelectorAll('.speech-bubble').forEach(el => el.remove());

  const bubble = document.createElement('div');
  bubble.className = 'speech-bubble';
  bubble.textContent = text;
  document.body.appendChild(bubble);

  // Estimate mouth position: pivot is at the book (top of model), mouth ~40px below
  const mouthX = Physics.state.pivotX;
  const mouthY = Physics.state.pivotY + 40;
  const W = window.innerWidth, H = window.innerHeight;
  const PAD = 12;

  requestAnimationFrame(() => {
    const bw = bubble.offsetWidth;
    const bh = bubble.offsetHeight;

    // Prefer bubble above mouth; fall back to below if too close to top
    const aboveY = mouthY - bh - 22;
    const belowY = mouthY + 22;
    const goAbove = aboveY >= PAD;

    // Prefer bubble on the side away from the screen centre
    const goRight = mouthX < W / 2;

    let bx, by, tailClass;

    if (goAbove) {
      by = aboveY;
      if (goRight) {
        bx = mouthX - 14;                  // bubble starts near mouth horizontally
        tailClass = 'tail-bl';             // tail at bottom-left → points down-left toward mouth
      } else {
        bx = mouthX - bw + 14;
        tailClass = 'tail-br';
      }
    } else {
      by = belowY;
      if (goRight) {
        bx = mouthX - 14;
        tailClass = 'tail-tl';
      } else {
        bx = mouthX - bw + 14;
        tailClass = 'tail-tr';
      }
    }

    // Clamp to viewport
    bx = Math.max(PAD, Math.min(W - bw - PAD, bx));
    by = Math.max(PAD, Math.min(H - bh - PAD, by));

    bubble.style.left = bx + 'px';
    bubble.style.top  = by + 'px';
    bubble.classList.add(tailClass);

    requestAnimationFrame(() => bubble.classList.add('visible'));
  });

  // Auto-dismiss after 5 s
  setTimeout(() => {
    bubble.classList.add('fade-out');
    setTimeout(() => bubble.remove(), 500);
  }, 5000);
}

// ─── Input ────────────────────────────────────────────────────────────────────
const DRAG_THRESHOLD = 6; // px — movement beyond this counts as a drag

function setupInput(wrap) {
  let mouseDownNear = false;
  let hasDragged    = false;
  let downX = 0, downY = 0;

  function getPos(e) {
    return e.touches ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : { x: e.clientX, y: e.clientY };
  }
  function nearYuumi(px, py) {
    // Settings panel — keep click-through off while it's open
    const panel = document.getElementById('settings-panel');
    if (panel && panel.style.display !== 'none') {
      const r = panel.getBoundingClientRect();
      if (px >= r.left && px <= r.right && py >= r.top && py <= r.bottom) return true;
    }
    // Dynamic bounding box rebuilt every frame from animated bone positions
    if (!yuumiScreenBounds) return false;
    return px >= yuumiScreenBounds.minX && px <= yuumiScreenBounds.maxX &&
           py >= yuumiScreenBounds.minY && py <= yuumiScreenBounds.maxY;
  }
  function clampPivot() {
    const W = window.innerWidth, H = window.innerHeight;
    // Top: pivot is the book, always the topmost visible element
    if (Physics.state.pivotY < HITBOX_PAD) Physics.state.pivotY = HITBOX_PAD;
    if (yuumiScreenBounds) {
      const b = yuumiScreenBounds, e = HITBOX_PAD;
      if (b.minX + e < 0) Physics.state.pivotX -= (b.minX + e);
      if (b.maxX - e > W) Physics.state.pivotX -= (b.maxX - e - W);
      if (b.maxY - e > H) Physics.state.pivotY -= (b.maxY - e - H);
    } else {
      Physics.state.pivotX = Math.max(60, Math.min(W-60,  Physics.state.pivotX));
      Physics.state.pivotY = Math.min(H-100, Physics.state.pivotY);
    }
  }

  wrap.addEventListener('contextmenu', (e) => e.preventDefault());

  wrap.addEventListener('mousedown', (e) => {
    const p = getPos(e);
    if (e.button === 2) {
      // Right-click: open settings
      if (nearYuumi(p.x, p.y)) showSettings();
      return;
    }
    if (nearYuumi(p.x, p.y)) {
      mouseDownNear = true;
      hasDragged    = false;
      downX = p.x; downY = p.y;
      grabOffsetX = Physics.state.pivotX - p.x;
      grabOffsetY = Physics.state.pivotY - p.y;
      // Don't set grabbed yet — wait for movement to confirm it's a drag
    }
  });
  window.addEventListener('mousemove', (e) => {
    const p = getPos(e);
    cursorX = p.x;
    cursorY = p.y;
    if (mouseDownNear && !hasDragged && Math.hypot(p.x - downX, p.y - downY) > DRAG_THRESHOLD) {
      hasDragged = true;
      grabbed    = true;
      wrap.style.cursor = 'grabbing';
      document.querySelectorAll('.speech-bubble').forEach(el => el.remove());
      if (currentAudio) { currentAudio.pause(); currentAudio = null; }
      playYelp(true);
    }
    if (grabbed) {
      Physics.state.pivotX = p.x + grabOffsetX;
      Physics.state.pivotY = p.y + grabOffsetY;
      clampPivot();
    } else {
      wrap.style.cursor = nearYuumi(p.x, p.y) ? 'grab' : 'default';
    }
    // Electron overlay: pass mouse events through when not interacting with Yuumi
    if (window.electronAPI) {
      window.electronAPI.setClickThrough(!grabbed && !nearYuumi(p.x, p.y));
    }
  });
  window.addEventListener('mouseup', () => {
    if (mouseDownNear && !hasDragged) onYuumiClick();
    else if (mouseDownNear && hasDragged) playYelp(true);
    grabbed       = false;
    mouseDownNear = false;
    hasDragged    = false;
    wrap.style.cursor = 'default';
  });

  wrap.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const p = getPos(e);
    mouseDownNear = true;
    hasDragged    = false;
    downX = p.x; downY = p.y;
    grabOffsetX = Physics.state.pivotX - p.x;
    grabOffsetY = Physics.state.pivotY - p.y;
    // Don't set grabbed yet — wait for movement
  }, { passive: false });
  window.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (!mouseDownNear) return;
    const p = getPos(e);
    if (!hasDragged && Math.hypot(p.x - downX, p.y - downY) > DRAG_THRESHOLD) {
      hasDragged = true;
      grabbed    = true;
      document.querySelectorAll('.speech-bubble').forEach(el => el.remove());
      if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    }
    if (grabbed) {
      Physics.state.pivotX = p.x + grabOffsetX;
      Physics.state.pivotY = p.y + grabOffsetY;
      clampPivot();
    }
  }, { passive: false });
  window.addEventListener('touchend', () => {
    if (mouseDownNear && !hasDragged) onYuumiClick();
    grabbed       = false;
    mouseDownNear = false;
    hasDragged    = false;
  });
}

// ─── UI ───────────────────────────────────────────────────────────────────────
function setStatus(t) { const el = document.getElementById('load-text'); if (el) el.textContent = t; }
function setProgress(p) { const el = document.getElementById('load-bar'); if (el) el.style.width = p + '%'; }
function showErr(msg) {
  const ov = document.getElementById('overlay');
  if (ov) ov.classList.add('hidden');
  const el = document.getElementById('err');
  el.style.display = 'block'; el.textContent = msg;
}
