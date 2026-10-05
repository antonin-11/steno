// Lancement du helper natif bin/steno-recorder
import path from "path";
import { app } from "electron";

// Dans Sténo.app, le code est dans une archive (app.asar) d'où un binaire ne peut pas être lancé :
// electron-builder copie le helper à côté, dans Contents/Resources/bin. En dev, il est dans bin/ à la racine du projet
export const RECORDER = app.isPackaged
    ? path.join(process.resourcesPath, "bin", "steno-recorder")
    : path.join(app.getAppPath(), "bin", "steno-recorder");
const DISCLAIM_EXEC = path.join(app.getAppPath(), "bin", "disclaim-exec");

// Commande et arguments pour lancer le helper avec les permissions macOS (micro, accessibilité) :
// - en dev, disclaim-exec l'en rend responsable, sinon elles iraient au terminal qui a lancé Sténo ;
// - dans Sténo.app, il utilise celles de l'app, que Réglages affiche sous « Sténo » avec son logo
export function helperCommand(...args: string[]): [string, string[]] {
    return app.isPackaged ? [RECORDER, args] : [DISCLAIM_EXEC, [RECORDER, ...args]];
}
