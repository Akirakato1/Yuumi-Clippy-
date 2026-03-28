# Yuumi Physics Drag — Local Setup

## Folder structure

```
yuumi-clippy/
  index.html        ← open this in browser
  app.js            ← Three.js scene, pose blending, render loop
  physics.js        ← spring-damper simulation
  yuumi_1_.glb      ← DROP YOUR FILE HERE
  libs/
    three.min.js    ← download separately (see below)
    GLTFLoader.js   ← download separately (see below)
```

## Step 1 — Add the GLB

Copy `yuumi_1_.glb` into the `yuumi-clippy/` folder.

## Step 2 — Download Three.js libs

Download these two files and place them in the `libs/` folder:

- **three.min.js**
  https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js

- **GLTFLoader.js**
  https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js

(Right-click → Save As in your browser, or use curl/wget)

## Step 3 — Run a local server

Browsers block local file:// access for GLB loading.
You need a simple HTTP server. Pick any:

### Option A — Node (if you have Node.js)
```bash
cd yuumi-clippy
npx serve .
# open http://localhost:3000
```

### Option B — Python
```bash
cd yuumi-clippy
python3 -m http.server 8080
# open http://localhost:8080
```

### Option C — VS Code
Install the "Live Server" extension, right-click index.html → Open with Live Server.

## Controls

- **Click + drag** anywhere on Yuumi or the book to grab and drag her
- **Release** to let her swing and settle back
- Spring physics drives the pose blend in real time
- Debug info shown top-left (disp, speed, anim time, blend weights)

## Tuning physics (in physics.js)

```js
k:       200,   // stiffness  — higher = snappier response
damping:  14,   // damping    — higher = less bouncy / quicker settle
mass:    1.0,   // mass       — higher = more sluggish/heavy feeling
restOffsetY: 100,  // px — natural hang distance below cursor
```

## How pose blending works

The `Dance_Loop` animation clip contains Yuumi being dangled and swung.
Rather than playing it as a timeline, we **scrub** to specific timestamps
that correspond to extreme poses:

| Pose       | Time in clip | Triggered by              |
|------------|-------------|---------------------------|
| Neutral    | 2.767s      | No displacement           |
| Swing right| 2.833s      | Mass displaced left of pivot |
| Swing left | 3.400s      | Mass displaced right of pivot|
| Body low   | 2.533s      | Mass below rest position  |

The spring's displacement vector → blend weights → weighted average
of those timestamps → `mixer.setTime(t)` every frame.
Three.js interpolates all 134 bones automatically.
