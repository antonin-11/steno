// Dictée : on maintient Option droite + Cmd droite, on parle, on relâche ; le texte transcrit est collé là où est le curseur
import fs from "fs";
import os from "os";
import path from "path";
import readline from "readline";
import { spawn, execFile, type ChildProcessWithoutNullStreams } from "child_process";
import { transcribe, transcriptionCost } from "./gateway-transcription";
import { helperCommand } from "./native-helper";
import type { OverlayState } from "../shared/types";

function osascript(...lines: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile("osascript", lines.flatMap((line) => ["-e", line]), (error, stdout) => (error ? reject(error) : resolve(stdout.trim())));
    });
}

// Coupe le son du Mac pendant qu'on parle, comme Wispr Flow. Renvoie s'il était déjà coupé
async function muteSystemAudio(): Promise<boolean> {
    try {
        return (await osascript("set wasMuted to output muted of (get volume settings)", "set volume with output muted", "return wasMuted")) === "true";
    } catch (error) {
        console.error("Impossible de couper le son:", (error as Error).message);
        // On ne remettra pas le son qu'on n'a pas réussi à couper
        return true;
    }
}

// Remet le son, sauf s'il était déjà coupé avant la dictée
async function restoreSystemAudio(wasMuted: Promise<boolean>) {
    if (await wasMuted) return;
    osascript("set volume without output muted").catch((error) => console.error("Impossible de remettre le son:", error.message));
}

// Lit les lignes JSON d'un helper
function onEvents(child: ChildProcessWithoutNullStreams, callback: (event: { type: string; [key: string]: any }) => void) {
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
        try {
            callback(JSON.parse(line));
        } catch {}
    });
}

export type Dictation = { text: string; durationMs: number; audioDurationSec: number; cost: number | null };

export function watchDictation({
    model,
    getPhrases,
    getLanguage,
    tryBegin,
    end,
    showOverlay,
    hideOverlay,
    setOverlayLevel,
    pasteText,
    onDictation,
}: {
    model: string;
    getPhrases: () => string[];
    getLanguage: () => string;
    tryBegin: () => boolean;
    end: () => void;
    showOverlay: (state: OverlayState) => void;
    hideOverlay: (delay: number) => void;
    setOverlayLevel: (level: number) => void;
    pasteText: (text: string, onPasted?: () => void) => Promise<void>;
    onDictation: (dictation: Dictation) => void;
}) {
    let recording: {
        child: ChildProcessWithoutNullStreams;
        dir: string;
        startedAt: number;
        exited: Promise<unknown>;
        wasMuted: Promise<boolean>;
    } | null = null;

    function start() {
        // Une correction ou une autre dictée est déjà en cours
        if (recording || !tryBegin()) return;

        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "steno-dictee-"));
        const child = spawn(...helperCommand("record", "--mic-only", "--out", dir));
        recording = {
            child,
            dir,
            startedAt: Date.now(),
            exited: new Promise((resolve) => child.on("close", resolve)),
            wasMuted: muteSystemAudio(),
        };

        child.on("error", (error) => console.error("Helper d'enregistrement introuvable (lancer pnpm run build:native):", error.message));
        child.stderr.on("data", (data) => console.error("dictée:", data.toString().trim()));
        onEvents(child, (event) => {
            if (event.type === "level") setOverlayLevel(event.mic);
            if (event.type === "error") console.error("Dictée:", event.message);
        });

        showOverlay("listening");
    }

    async function stop() {
        if (!recording) return;
        const { child, dir, startedAt, exited, wasMuted } = recording;
        recording = null;
        const releasedAt = Date.now();

        child.kill("SIGTERM");
        // Le son revient dès qu'on relâche, sans attendre la transcription
        restoreSystemAudio(wasMuted);
        await exited;
        showOverlay("loading");

        try {
            const phrases = getPhrases();
            const language = getLanguage();
            const result = await transcribe(path.join(dir, "mic.wav"), model, {
                transcribeStyle: "clean",
                ...(phrases.length > 0 && { phraseList: { phrases } }),
                ...(language !== "auto" && { locales: [language] }),
            });

            // Rien n'est collé si aucune parole n'a été reconnue
            const text = result.text.trim();
            if (!text) {
                showOverlay("error");
                hideOverlay(2000);
                return;
            }

            // La bulle disparaît au moment où le texte est collé, sans coche de validation
            await pasteText(text, () => hideOverlay(0));
            onDictation({
                text,
                durationMs: Date.now() - releasedAt,
                audioDurationSec: (releasedAt - startedAt) / 1000,
                cost: transcriptionCost([result]),
            });
        } catch (error) {
            console.error("Échec de la dictée:", error);
            showOverlay("error");
            hideOverlay(2000);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
            end();
        }
    }

    const hotkey = spawn(...helperCommand("hotkey"));
    hotkey.on("error", (error) => console.error("Helper de raccourci introuvable (lancer pnpm run build:native):", error.message));
    hotkey.on("exit", (code) => code !== null && console.error(`Helper de raccourci arrêté (code ${code})`));
    hotkey.stderr.on("data", (data) => console.error("hotkey:", data.toString().trim()));
    onEvents(hotkey, (event) => {
        if (event.type === "down") start();
        if (event.type === "up") stop();
        if (event.type === "error") console.error("Raccourci de dictée:", event.message);
    });

    return {
        // À la fermeture de l'app : les helpers ne doivent pas continuer à tourner
        stop() {
            hotkey.kill();
            recording?.child.kill("SIGTERM");
        },
    };
}
