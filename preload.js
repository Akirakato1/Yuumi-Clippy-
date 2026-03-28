const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setClickThrough: (ignore) => ipcRenderer.send('set-clickthrough', ignore),
  openDevTools:    ()       => ipcRenderer.send('open-devtools'),
  readConfig:      ()       => ipcRenderer.invoke('read-config'),
  writeConfig:     (cfg)    => ipcRenderer.send('write-config', cfg),
  quitApp:         ()       => ipcRenderer.send('quit-app'),
});
