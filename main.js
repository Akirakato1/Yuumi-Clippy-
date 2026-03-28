const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, globalShortcut, screen } = require('electron');
const path = require('path');
const fs   = require('fs');

const CONFIG_PATH = path.join(app.getPath('userData'), 'yuumi-settings.json');

let win;
let tray;

// Smallest valid 1×1 PNG — used as fallback tray icon if tray-icon.png is missing
const FALLBACK_ICON_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

app.whenReady().then(() => {
  const { bounds } = screen.getPrimaryDisplay();

  win = new BrowserWindow({
    x:          bounds.x,
    y:          bounds.y,
    width:      bounds.width,
    height:     bounds.height,
    transparent: true,
    frame:       false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable:   false,
    hasShadow:   false,
    focusable:   false,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      webSecurity:      false,   // allow local file XHR (GLB / JSON loading)
    },
  });

  win.loadFile('index.html');
  win.setAlwaysOnTop(true, 'screen-saver');

  // Start fully click-through; renderer toggles this via IPC
  win.setIgnoreMouseEvents(true, { forward: true });

  ipcMain.on('set-clickthrough', (_e, ignore) => {
    win.setIgnoreMouseEvents(ignore, { forward: true });
  });

  ipcMain.on('open-devtools', () => {
    win.webContents.openDevTools({ mode: 'detach' });
  });

  ipcMain.on('quit-app', () => app.quit());

  ipcMain.handle('read-config', () => {
    try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return null; }
  });

  ipcMain.on('write-config', (_e, cfg) => {
    try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch {}
  });

  // Re-assert Z-order every 500 ms.
  // On Windows, HWND_TOPMOST windows are ordered by last activation; since
  // this window is non-focusable it can never win naturally, so we push it
  // back to the top of the topmost stack periodically.
  setInterval(() => {
    if (win && !win.isDestroyed()) win.moveTop();
  }, 500);

  // Also re-assert immediately whenever any other window gains focus.
  app.on('browser-window-focus', () => {
    if (win && !win.isDestroyed()) win.moveTop();
  });

  // ── Tray ─────────────────────────────────────────────────────────────────
  let icon;
  try {
    icon = nativeImage.createFromPath(path.join(__dirname, 'tray-icon.png'));
    if (icon.isEmpty()) throw new Error('empty');
  } catch {
    icon = nativeImage.createFromDataURL(`data:image/png;base64,${FALLBACK_ICON_B64}`);
  }

  tray = new Tray(icon);
  tray.setToolTip('Yuumi Clippy');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Yuumi Clippy', enabled: false },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));

  // ── Global quit shortcut (Ctrl+Shift+Q) ──────────────────────────────────
  globalShortcut.register('CommandOrControl+Shift+Q', () => app.quit());
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
