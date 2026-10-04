// Dictée : on maintient Option droite, on parle, on relâche ; le texte transcrit est collé là où est le curseur
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { spawn, execFile } = require("child_process");
const { transcribe, transcriptionCost } = require("./gateway-transcription");

const RECORDER = path.join(__dirname, "bin", "steno-recorder");
// Rend le helper responsable de ses propres permissions macOS (micro, surveillance du clavier)
const DISCLAIM_EXEC = path.join(__dirname, "bin", "disclaim-exec");

function osascript(...lines) {
    return new Promise((resolve, reject) => {
        execFile("osascript", lines.flatMap((line) => ["-e", line]), (error, stdout) => (error ? reject(error) : resolve(stdout.trim())));
    });
}

// Coupe le son du Mac pendant qu'on parle, comme Wispr Flow. Renvoie s'il était déjà coupé
async function muteSystemAudio() {
    try {
        return (await osascript("set wasMuted to output muted of (get volume settings)", "set volume with output muted", "return wasMuted")) === "true";
    } catch (error) {
        console.error("Impossible de couper le son:", error.message);
        // On ne remettra pas le son qu'on n'a pas réussi à couper
        return true;
    }
}

// Remet le son, sauf s'il était déjà coupé avant la dictée
async function restoreSystemAudio(wasMuted) {
    if (await wasMuted) return;
    osascript("set volume without output muted").catch((error) => console.error("Impossible de remettre le son:", error.message));
}

// Lit les lignes JSON d'un helper
function onEvents(child, callback) {
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
        try {
            callback(JSON.parse(line));
        } catch {}
    });
}

function watchDictation({ model, getPhrases, getLanguage, tryBegin, end, showOverlay, hideOverlay, setOverlayLevel, pasteText, onDictation }) {
    let recording = null;

    function start() {
        // Une correction ou une autre dictée est déjà en cours
        if (recording || !tryBegin()) return;

        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "steno-dictee-"));
        const child = spawn(DISCLAIM_EXEC, [RECORDER, "record", "--mic-only", "--out", dir]);
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

            await pasteText(text);
            showOverlay("done");
            hideOverlay(800);
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

    // Une autre touche a été pressée avec Option droite : c'était un raccourci clavier, pas une dictée
    function cancel() {
        if (!recording) return;
        const { child, dir, exited, wasMuted } = recording;
        recording = null;

        child.kill("SIGTERM");
        restoreSystemAudio(wasMuted);
        exited.then(() => fs.rmSync(dir, { recursive: true, force: true }));
        hideOverlay(0);
        end();
    }

    const hotkey = spawn(DISCLAIM_EXEC, [RECORDER, "hotkey"]);
    hotkey.on("error", (error) => console.error("Helper de raccourci introuvable (lancer pnpm run build:native):", error.message));
    hotkey.on("exit", (code) => code !== null && console.error(`Helper de raccourci arrêté (code ${code})`));
    hotkey.stderr.on("data", (data) => console.error("hotkey:", data.toString().trim()));
    onEvents(hotkey, (event) => {
        if (event.type === "down") start();
        if (event.type === "up") stop();
        if (event.type === "cancel") cancel();
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

module.exports = { watchDictation };
