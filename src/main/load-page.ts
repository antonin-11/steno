import path from "path";
import { app, type BrowserWindow } from "electron";

// Charge la page d'une fenêtre : depuis le serveur de Vite en dev (mise à jour à chaud), sinon le fichier compilé
export function loadPage(win: BrowserWindow, page: "index" | "overlay" | "recording") {
    const devServer = process.env.ELECTRON_RENDERER_URL;
    if (!app.isPackaged && devServer) win.loadURL(`${devServer}/${page}.html`);
    else win.loadFile(path.join(__dirname, "../renderer", `${page}.html`));
}

// Preload commun aux trois fenêtres, compilé à côté du processus principal
export const PRELOAD = path.join(__dirname, "../preload/index.js");
