# Yuumi Clippy

A desktop companion overlay featuring Yuumi from League of Legends. She sits always-on-top of your screen, reacts to being grabbed and dragged with spring physics, plays in-game voice lines, and displays speech bubbles with subtitles.

Built with **Electron** + **Three.js**.

## Features

- **Spring physics drag** — click and drag Yuumi; her body swings and settles based on a spring-damper simulation
- **Dual-GLB animation crossfade** — separate idle and drag GLB models crossfade smoothly based on physics displacement
- **Bone secondary motion** — 134-bone rig with pose blending driven by the spring's displacement vector
- **Voice lines** — plays Yuumi's in-game audio clips with lip-sync jaw animation
- **Speech bubbles** — subtitled quotes appear near Yuumi with smart positioning
- **Multiple skins** — Base, EDG, and Principal skins selectable at runtime
- **Settings panel** — adjust quote volume, yelp volume, size, opacity, and cursor-follow mode
- **System tray** — lives in the tray; quit from there or with `Ctrl+Shift+Q`
- **Always-on-top** — click-through by default, only interactive when hovering over Yuumi

## Folder structure

```
yuumi-clippy/
  main.js               ← Electron main process (window, tray, IPC)
  preload.js            ← Context bridge (renderer ↔ main)
  index.html            ← UI shell and CSS
  app.js                ← Three.js scene, animation, speech bubbles, audio
  physics.js            ← Spring-damper simulation
  generate_jaw_data.js  ← Utility: bakes jaw bone keyframes to yuumi_jaw_data.json
  yuumi_quotes.json     ← Quote text + audio file mappings
  yuumi_jaw_data.json   ← Pre-baked jaw animation data for lip-sync
  libs/
    three.min.js        ← Three.js r128 (must be added manually — see below)
    GLTFLoader.js       ← Three.js GLTFLoader (must be added manually — see below)
  yuumi_models/
    default_yuumi_idle.glb
    default_yuumi_drag.glb
    edg_yuumi_idle.glb
    edg_yuumi_drag.glb
    principal_yuumi_idle.glb
    principal_yuumi_drag.glb
  yuumi_quotes_audio/
    *.ogg               ← Yuumi voice line audio clips
  build/
    icon.ico            ← App icon for Windows build
```

## Building from source

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later recommended)
- The `yuumi_models/`, `yuumi_quotes_audio/`, and `libs/` folders (see below)

### 1. Clone the repo

```bash
git clone https://github.com/your-username/yuumi-clippy.git
cd yuumi-clippy
```

### 2. Add the required binary folders

These folders contain binary assets that are not installable via npm and must be present before building:

| Folder | Contents | Why manual |
|--------|----------|-----------|
| `yuumi_models/` | Six `.glb` 3D model files (idle + drag per skin) | Binary, too large for npm |
| `yuumi_quotes_audio/` | Yuumi `.ogg` voice line clips | Game audio assets |
| `libs/` | `three.min.js` and `GLTFLoader.js` | Vendored JS libs |

**For `libs/`**, download these two files and place them in the `libs/` folder:

- **three.min.js** — Three.js r128
  `https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js`

- **GLTFLoader.js** — Three.js GLTF loader
  `https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js`

### 3. Install dependencies

```bash
npm install
```

### 4. Run in development

```bash
npm start
```

### 5. Build a distributable (Windows)

```bash
npm run build:win
```

Output goes to `dist/`. Produces both an NSIS installer and a portable `.exe`.

> **Note:** The build requires `build/icon.ico` to exist. If you don't have one, create a placeholder or remove the `"icon"` line from `package.json` under `"win"`.

## Controls

| Action | Result |
|--------|--------|
| Click + drag Yuumi | Grab and swing her around |
| Release | She swings back and settles with spring physics |
| Right-click | Open settings panel |
| Tray icon | Access settings or quit |
| `Ctrl+Shift+Q` | Quit immediately |

## Physics tuning (`physics.js`)

```js
k:            200,   // stiffness  — higher = snappier response
damping:       14,   // damping    — higher = less bouncy / quicker settle
mass:         1.0,   // mass       — higher = more sluggish/heavy feeling
restOffsetY:  100,   // px — natural hang distance below cursor
```

## How pose blending works

The drag GLB contains Yuumi's swing/dangle animation. Instead of playing it as a timeline, the spring's displacement vector is mapped to specific timestamps in the clip, then `mixer.setTime(t)` is called every frame. Three.js interpolates all bones automatically.

| Pose | Clip time | Condition |
|------|-----------|-----------|
| Neutral | 2.767 s | No displacement |
| Swing right | 2.833 s | Mass displaced left of pivot |
| Swing left | 3.400 s | Mass displaced right of pivot |
| Body low | 2.533 s | Mass below rest position |
