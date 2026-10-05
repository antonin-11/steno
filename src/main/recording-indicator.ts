// Indicateur d'enregistrement : pilule flottante en bas au centre, ou point rouge dans la barre de menus
import fs from "fs";
import { BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen } from "electron";
import { loadPage, PRELOAD } from "./load-page";
import type { AudioLevels, IndicatorState } from "../shared/types";

const PILL_WIDTH = 240;
const PILL_HEIGHT = 50;
const PILL_MARGIN = 16;
// Durée d'affichage de « Transcription prête » ou de l'erreur
const RESULT_DISPLAY_MS = 3000;

type Mode = "pill" | "tray";

// Point rouge dessiné en mémoire (16 pt en @2x), pour ne pas avoir de fichier d'icône
function redDot() {
    const size = 32;
    const radius = 7;
    const buffer = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const alpha = Math.min(1, Math.max(0, radius + 0.5 - Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2)));
            const i = (y * size + x) * 4;
            // BGRA, couleurs prémultipliées par l'opacité
            buffer[i] = 68 * alpha;
            buffer[i + 1] = 68 * alpha;
            buffer[i + 2] = 239 * alpha;
            buffer[i + 3] = 255 * alpha;
        }
    }
    return nativeImage.createFromBitmap(buffer, { width: size, height: size, scaleFactor: 2 });
}

function formatElapsed(ms: number) {
    const total = Math.floor(ms / 1000);
    const minutes = Math.floor(total / 60);
    const seconds = String(total % 60).padStart(2, "0");
    return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

export type RecordingIndicator = ReturnType<typeof createRecordingIndicator>;

export function createRecordingIndicator({ settingsFile, onStop }: { settingsFile: string; onStop: () => void }) {
    let mode: Mode = "pill";
    try {
        mode = JSON.parse(fs.readFileSync(settingsFile, "utf8")).indicator ?? mode;
    } catch {}

    let state: IndicatorState["state"] = "hidden";
    let label = "";
    let startedAt: Date | null = null;
    let tray: Tray | null = null;
    let trayTimer: NodeJS.Timeout | undefined;
    let hideTimer: NodeJS.Timeout | undefined;

    const pill = new BrowserWindow({
        width: PILL_WIDTH,
        height: PILL_HEIGHT,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        focusable: false,
        skipTaskbar: true,
        hasShadow: false,
        show: false,
        // Le clic sur stop doit marcher sans activer la fenêtre d'abord
        acceptFirstMouse: true,
        type: process.platform === "darwin" ? "panel" : undefined,
        webPreferences: { preload: PRELOAD },
    });
    pill.setAlwaysOnTop(true, "screen-saver");
    pill.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    loadPage(pill, "recording");

    const sendState = () => pill.webContents.send("indicator-state", { state, startedAt: startedAt?.getTime() ?? null } satisfies IndicatorState);
    pill.webContents.on("did-finish-load", sendState);

    function setMode(newMode: Mode) {
        mode = newMode;
        let settings = {};
        try {
            settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
        } catch {}
        fs.writeFileSync(settingsFile, JSON.stringify({ ...settings, indicator: mode }, null, 2));
        render();
    }

    ipcMain.on("indicator-stop", () => onStop());
    ipcMain.on("indicator-menu", () => {
        Menu.buildFromTemplate([
            { label: "Masquer", click: () => setMode("tray") },
            { label: "Arrêter l'enregistrement", click: () => onStop() },
        ]).popup({ window: pill });
    });

    function renderPill() {
        if (state !== "hidden" && mode === "pill") {
            if (!pill.isVisible()) {
                // Sur l'écran où se trouve la souris, comme la pilule de correction
                const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
                pill.setPosition(
                    Math.round(workArea.x + (workArea.width - PILL_WIDTH) / 2),
                    Math.round(workArea.y + workArea.height - PILL_HEIGHT - PILL_MARGIN)
                );
            }
            sendState();
            pill.showInactive();
        } else if (pill.isVisible()) {
            pill.webContents.send("indicator-state", { state: "hidden" } satisfies IndicatorState);
            // Laisse le temps à l'animation de disparition (sauf si la pilule doit réapparaître entre-temps)
            setTimeout(() => {
                if (state === "hidden" || mode !== "pill") pill.hide();
            }, 200);
        }
    }

    function trayTitle() {
        if (state === "recording") return formatElapsed(Date.now() - (startedAt?.getTime() ?? Date.now()));
        if (state === "processing") return "Transcription…";
        if (state === "done") return "Transcription prête";
        return "Échec";
    }

    function renderTray() {
        clearInterval(trayTimer);
        if (state === "hidden" || mode !== "tray") {
            tray?.destroy();
            tray = null;
            return;
        }

        tray ??= new Tray(redDot());
        tray.setTitle(trayTitle());
        tray.setToolTip(`Enregistrement · ${label}`);
        tray.setContextMenu(
            Menu.buildFromTemplate([
                ...(state === "recording" ? [{ label: "Arrêter l'enregistrement", click: () => onStop() }] : []),
                { label: "Afficher la pilule", click: () => setMode("pill") },
            ])
        );
        if (state === "recording") trayTimer = setInterval(() => tray?.setTitle(trayTitle()), 1000);
    }

    function render() {
        renderPill();
        renderTray();
    }

    function setState(newState: IndicatorState["state"]) {
        clearTimeout(hideTimer);
        state = newState;
        render();
    }

    return {
        showRecording(newLabel: string, start: Date) {
            label = newLabel;
            startedAt = start;
            setState("recording");
        },
        setLevels(levels: AudioLevels) {
            if (state === "recording" && mode === "pill") pill.webContents.send("indicator-levels", levels);
        },
        showProcessing() {
            setState("processing");
        },
        showResult(ok: boolean) {
            setState(ok ? "done" : "error");
            hideTimer = setTimeout(() => setState("hidden"), RESULT_DISPLAY_MS);
        },
        // Utilisé pour placer la pilule de correction au-dessus
        isPillVisible: () => state !== "hidden" && mode === "pill",
        height: PILL_HEIGHT,
    };
}
