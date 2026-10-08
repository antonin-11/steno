// Dictée : on maintient Option droite + Cmd droite, on parle, on relâche ; le texte transcrit est collé là où est le curseur
import fs from "fs";
import os from "os";
import path from "path";
import readline from "readline";
import { spawn, execFile, type ChildProcessWithoutNullStreams } from "child_process";
import { powerMonitor } from "electron";
import { transcribe, transcriptionCost } from "./gateway-transcription";
import { removeFillers, startLiveTranscription, type LiveTranscription } from "./live-transcription";
import { helperCommand } from "./native-helper";
import type { OverlayState } from "../shared/types";

// En dessous, les touches ont été relâchées avant que le micro ait vraiment démarré : rien n'est envoyé
const MIN_AUDIO_SECONDS = 0.1;

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

// fastMode : "ok" si le texte vient du mode rapide, "fallback" s'il a échoué et que la transcription normale a pris le relais
export type Dictation = { text: string; durationMs: number; audioDurationSec: number; cost: number | null; fastMode?: "ok" | "fallback" };

// Helper d'enregistrement de la dictée, lancé avec --standby : il prépare le micro et l'ouvre à la première ligne reçue.
// onAudio reçoit le son au fil de l'eau en mode rapide
type Recorder = {
    child: ChildProcessWithoutNullStreams;
    dir: string;
    exited: Promise<unknown>;
    seconds: number;
    error: string | null;
    onAudio?: (pcm: string) => void;
};

export function watchDictation({
    model,
    fastModel,
    getPhrases,
    getLanguage,
    isFastMode,
    tryBegin,
    end,
    showOverlay,
    hideOverlay,
    setOverlayLevel,
    pasteText,
    onDictation,
}: {
    model: string;
    fastModel: string;
    getPhrases: () => string[];
    getLanguage: () => string;
    isFastMode: () => boolean;
    tryBegin: () => boolean;
    end: () => void;
    showOverlay: (state: OverlayState) => void;
    hideOverlay: (delay: number) => void;
    setOverlayLevel: (level: number) => void;
    pasteText: (text: string, onPasted?: () => void) => Promise<void>;
    onDictation: (dictation: Dictation) => void;
}) {
    let recording: { recorder: Recorder; live: LiveTranscription | null; startedAt: number; wasMuted: Promise<boolean> } | null = null;
    // Helper lancé à l'avance, micro préparé mais fermé : à l'appui, il ne reste qu'à l'ouvrir (une dizaine de ms).
    // Lancé à l'appui, il fallait 0,1 à 0,25 s, et 2 à 3,5 s quand macOS relançait d'abord son registre des composants audio
    let standby: Recorder | null = null;
    // Transcription en cours, que la croix de la pastille peut annuler
    let transcription: AbortController | null = null;
    let closed = false;

    function spawnRecorder(): Recorder {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "steno-dictee-"));
        const child = spawn(...helperCommand("record", "--mic-only", "--standby", "--out", dir));
        const recorder: Recorder = { child, dir, exited: new Promise((resolve) => child.on("close", resolve)), seconds: 0, error: null };

        child.on("error", (error) => console.error("Helper d'enregistrement introuvable (lancer pnpm run build:native):", error.message));
        // Écrire à un helper déjà arrêté ne doit pas faire planter l'app
        child.stdin.on("error", () => {});
        child.stderr.on("data", (data) => console.error("dictée:", data.toString().trim()));
        onEvents(child, (event) => {
            if (event.type === "level") setOverlayLevel(event.mic);
            if (event.type === "audio") recorder.onAudio?.(event.pcm);
            if (event.type === "stopped") recorder.seconds = event.seconds;
            if (event.type === "error") {
                recorder.error = event.message;
                console.error("Dictée:", event.message);
            }
        });
        return recorder;
    }

    // Prépare le helper de la prochaine dictée
    function prepareStandby() {
        if (closed || standby) return;
        const recorder = spawnRecorder();
        standby = recorder;
        // Arrêté sans avoir servi (micro refusé…) : la prochaine dictée en lancera un à l'appui
        recorder.exited.then(() => {
            if (standby !== recorder) return;
            standby = null;
            fs.rmSync(recorder.dir, { recursive: true, force: true });
        });
    }

    function discardStandby() {
        const recorder = standby;
        if (!recorder) return;
        standby = null;
        recorder.child.kill("SIGTERM");
        recorder.exited.then(() => fs.rmSync(recorder.dir, { recursive: true, force: true }));
    }

    function start() {
        // Une correction ou une autre dictée est déjà en cours
        if (recording || !tryBegin()) return;

        // Sans helper prêt (il vient d'être lancé, ou s'est arrêté), on en lance un : il ouvrira le micro dès qu'il pourra
        const recorder = standby ?? spawnRecorder();
        standby = null;
        // Mode rapide : la transcription démarre avec le micro et reçoit le son pendant qu'on parle
        const live = isFastMode() ? startLiveTranscription(fastModel) : null;
        recorder.onAudio = live?.push;
        recorder.child.stdin.write(live ? "start stream\n" : "start\n");
        recording = { recorder, live, startedAt: Date.now(), wasMuted: muteSystemAudio() };

        showOverlay("listening");
    }

    async function stop() {
        if (!recording) return;
        const { recorder, live, startedAt, wasMuted } = recording;
        recording = null;
        const releasedAt = Date.now();

        // Le helper garde le son jusqu'à cet instant, pas au-delà
        recorder.child.kill("SIGTERM");
        // Le son revient dès qu'on relâche, sans attendre la transcription
        restoreSystemAudio(wasMuted);
        await recorder.exited;
        // Le helper suivant se prépare pendant la transcription, pendant que le registre audio de macOS est encore lancé
        prepareStandby();

        const aborter = new AbortController();
        if (live) aborter.signal.addEventListener("abort", live.abort);
        try {
            if (recorder.error) throw new Error(recorder.error);
            // Relâchée avant l'ouverture du micro : rien à transcrire, croix rouge comme pour une dictée sans parole
            if (recorder.seconds < MIN_AUDIO_SECONDS) {
                live?.abort();
                showOverlay("error");
                hideOverlay(2000);
                return;
            }

            showOverlay("loading");
            transcription = aborter;
            let transcript: { text: string; cost: number | null } | null = null;
            let fastMode: Dictation["fastMode"];
            if (live) {
                try {
                    const result = await live.finish();
                    transcript = { text: removeFillers(result.text), cost: result.cost };
                    fastMode = "ok";
                } catch (error) {
                    if (aborter.signal.aborted) return;
                    // Le son est déjà enregistré : la transcription normale prend le relais
                    console.error("Mode rapide en échec, transcription normale:", (error as Error).message);
                    fastMode = "fallback";
                }
            }
            if (!transcript) {
                const phrases = getPhrases();
                const language = getLanguage();
                const result = await transcribe(
                    path.join(recorder.dir, "mic.wav"),
                    model,
                    {
                        transcribeStyle: "clean",
                        ...(phrases.length > 0 && { phraseList: { phrases } }),
                        ...(language !== "auto" && { locales: [language] }),
                    },
                    aborter.signal
                );
                transcript = { text: result.text, cost: transcriptionCost([result]) };
            }
            // Une fois le texte reçu, la croix n'annule plus rien
            transcription = null;
            if (aborter.signal.aborted) return;

            // Rien n'est collé si aucune parole n'a été reconnue
            const text = transcript.text.trim();
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
                cost: transcript.cost,
                fastMode,
            });
        } catch (error) {
            // Annulée par la croix : la pastille est déjà masquée
            if (aborter.signal.aborted) return;
            console.error("Échec de la dictée:", error);
            showOverlay("error");
            hideOverlay(2000);
        } finally {
            transcription = null;
            fs.rmSync(recorder.dir, { recursive: true, force: true });
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

    // Au réveil du Mac, le micro préparé avant la veille n'est plus fiable : on en prépare un neuf
    powerMonitor.on("resume", () => {
        discardStandby();
        prepareStandby();
    });
    prepareStandby();

    return {
        // Croix de la pastille : la transcription en cours est abandonnée, rien n'est collé ni ajouté à l'historique
        cancel() {
            if (!transcription) return;
            transcription.abort();
            transcription = null;
            hideOverlay(0);
        },
        // À la fermeture de l'app : les helpers ne doivent pas continuer à tourner
        stop() {
            closed = true;
            hotkey.kill();
            recording?.recorder.child.kill("SIGTERM");
            recording?.live?.abort();
            discardStandby();
        },
    };
}
