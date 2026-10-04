const { contextBridge, ipcRenderer } = require("electron");

// API exposée à la pilule d'enregistrement
contextBridge.exposeInMainWorld("indicator", {
    onState: (callback) => ipcRenderer.on("indicator-state", (_event, state) => callback(state)),
    onLevels: (callback) => ipcRenderer.on("indicator-levels", (_event, levels) => callback(levels)),
    stop: () => ipcRenderer.send("indicator-stop"),
    openMenu: () => ipcRenderer.send("indicator-menu"),
});
