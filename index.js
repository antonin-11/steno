require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { app, globalShortcut, clipboard, BrowserWindow, ipcMain, screen } = require("electron");
const OpenAI = require("openai");
const { watchVoiceMemos, getMemoText } = require("./voice-memos");
const { watchCalls } = require("./call-detector");
const { createMeetings } = require("./meetings");
const { createRecordingIndicator } = require("./recording-indicator");
const { watchDictation } = require("./dictation");

// Les données (historique, dictionnaire, réunions) restent dans le dossier créé sous l'ancien nom de l'app
app.setPath("userData", path.join(app.getPath("appData"), "spell-check-electron"));

const model = "deepseek/deepseek-v4-flash";
// Modèle utilisé pour les mémos vocaux sans transcription Apple
const transcriptionModel = "openai/gpt-4o-mini-transcribe";
// Modèle utilisé pour les appels enregistrés (avec séparation des interlocuteurs)
const meetingTranscriptionModel = "microsoft/mai-transcribe-2";
// Modèle utilisé pour la dictée (Option droite maintenue)
const dictationModel = "microsoft/mai-transcribe-2";
// Langue de la dictée tant qu'aucune autre n'est choisie dans la page Dictées
const DEFAULT_DICTATION_LANGUAGE = "fr";

// Fournisseur le plus rapide mesuré sur le Gateway pour ce modèle (les autres restent en secours)
const provider = "baseten";

// Vercel AI Gateway expose une API compatible OpenAI
const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1";
const openai = new OpenAI({
    apiKey: process.env.AI_GATEWAY_API_KEY,
    baseURL: GATEWAY_URL,
});

const prompt = fs.readFileSync("prompt.txt", "utf8");

const OVERLAY_WIDTH = 120;
const OVERLAY_HEIGHT = 50;
const OVERLAY_MARGIN = 16;

// Nombre maximum de corrections gardées dans l'historique
const HISTORY_LIMIT = 500;

// Délai avant de remettre le presse-papiers après un collage, le temps que l'app cible lise le texte
const CLIPBOARD_RESTORE_DELAY_MS = 500;

// Récupération du coût : le Gateway enregistre la génération avec quelques secondes de retard
const COST_LOOKUP_TIMEOUT_MS = 5000;
const COST_LOOKUP_ATTEMPTS = 10;
const COST_LOOKUP_DELAY_MS = 2000;

let overlay = null;
let mainWindow = null;
let hideTimer = null;
let busy = false;
let quitting = false;
let voiceStatus = { available: null };
let indicator = null;
let meetings = null;
let callWatcher = null;
let dictation = null;

function historyPath() {
    return path.join(app.getPath("userData"), "history.json");
}

function readHistory() {
    try {
        return JSON.parse(fs.readFileSync(historyPath(), "utf8"));
    } catch {
        return [];
    }
}

function saveHistory(history) {
    fs.writeFileSync(historyPath(), JSON.stringify(history, null, 2));

    if (mainWindow) {
        mainWindow.webContents.send("history-updated", history);
    }
}

function addToHistory(entry) {
    saveHistory([entry, ...readHistory()].slice(0, HISTORY_LIMIT));
}

function updateHistoryEntry(id, changes) {
    saveHistory(readHistory().map((entry) => (entry.id === id ? { ...entry, ...changes } : entry)));
}

function dictionaryPath() {
    return path.join(app.getPath("userData"), "dictionary.json");
}

function readDictionary() {
    try {
        return JSON.parse(fs.readFileSync(dictionaryPath(), "utf8"));
    } catch {
        return [];
    }
}

function saveDictionary(words) {
    fs.writeFileSync(dictionaryPath(), JSON.stringify(words, null, 2));
    return words;
}

function addWord(word) {
    const words = readDictionary();
    const trimmed = word.trim();
    const exists = words.some((w) => w.toLowerCase() === trimmed.toLowerCase());
    if (!trimmed || exists) return words;
    return saveDictionary([...words, trimmed].sort((a, b) => a.localeCompare(b, "fr")));
}

function removeWord(word) {
    return saveDictionary(readDictionary().filter((w) => w !== word));
}

// Réglages de l'app (langue de la dictée, mode de l'indicateur d'enregistrement)
function settingsPath() {
    return path.join(app.getPath("userData"), "settings.json");
}

function readSettings() {
    try {
        return JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    } catch {
        return {};
    }
}

function updateSettings(changes) {
    fs.writeFileSync(settingsPath(), JSON.stringify({ ...readSettings(), ...changes }, null, 2));
}

// Prompt système, complété par les mots du dictionnaire à ne jamais corriger
function buildSystemPrompt() {
    const words = readDictionary();
    if (words.length === 0) return prompt;

    return `${prompt}

Les mots et expressions suivants sont correctement orthographiés, y compris leurs majuscules. Ne les corrige jamais et conserve-les exactement tels quels :
${words.map((w) => `- ${w}`).join("\n")}`;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Demande au Gateway le coût exact d'une génération, avec timeout et plusieurs essais
async function fetchGenerationCost(generationId) {
    for (let attempt = 1; attempt <= COST_LOOKUP_ATTEMPTS; attempt++) {
        await wait(COST_LOOKUP_DELAY_MS);

        try {
            const response = await fetch(`${GATEWAY_URL}/generation?id=${encodeURIComponent(generationId)}`, {
                headers: { Authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}` },
                signal: AbortSignal.timeout(COST_LOOKUP_TIMEOUT_MS),
            });

            if (response.ok) {
                const { data } = await response.json();
                return data;
            }

            // Une erreur d'authentification ou de requête ne se réglera pas en réessayant
            if (response.status === 400 || response.status === 401 || response.status === 403) {
                throw new Error(`HTTP ${response.status}`);
            }
            // 404 : génération pas encore enregistrée ; 5xx : on réessaie aussi
        } catch (error) {
            if (error.message.startsWith("HTTP 4")) throw error;
            // Timeout ou erreur réseau : on réessaie
        }
    }

    throw new Error(`coût introuvable après ${COST_LOOKUP_ATTEMPTS} essais`);
}

async function resolveCost(entry) {
    try {
        const generation = await fetchGenerationCost(entry.generationId);
        updateHistoryEntry(entry.id, {
            cost: generation.total_cost,
            costStatus: "exact",
            provider: generation.provider_name,
        });
    } catch (error) {
        console.error(`Coût indisponible pour ${entry.generationId}:`, error.message);
        updateHistoryEntry(entry.id, { costStatus: "unavailable" });
    }
}

async function correctText(text) {
    try {
        const completion = await openai.chat.completions.create({
            model: model,
            messages: [
                {
                    role: "system",
                    content: buildSystemPrompt(),
                },
                {
                    role: "user",
                    content: text,
                },
            ],
            // Extensions du Gateway, absentes des types du SDK OpenAI
            ...{
                providerOptions: { gateway: { order: [provider] } },
                // Pas de réflexion préalable : réponse plus rapide
                reasoning: { effort: "none" },
            },
        });

        console.log("Response recieved");

        return {
            text: completion.choices[0].message.content,
            usage: completion.usage,
            // Identifiant de génération du Gateway, pour récupérer le coût exact ensuite
            generationId: completion.id,
        };
    } catch (error) {
        console.error("Erreur lors de la correction:", error);
        throw error;
    }
}

// Pastille flottante en bas au centre de l'écran, qui ne prend jamais le focus
function createOverlay() {
    overlay = new BrowserWindow({
        width: OVERLAY_WIDTH,
        height: OVERLAY_HEIGHT,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        focusable: false,
        skipTaskbar: true,
        hasShadow: false,
        show: false,
        // Sur macOS, seul un panneau (NSPanel) peut s'afficher par-dessus une app en plein écran
        // quand l'app a une icône dans le Dock
        type: process.platform === "darwin" ? "panel" : undefined,
    });
    overlay.setAlwaysOnTop(true, "screen-saver");
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlay.setIgnoreMouseEvents(true);
    overlay.loadFile(path.join(__dirname, "overlay.html"));
}

// Fenêtre principale avec l'historique des corrections
function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 760,
        minWidth: 760,
        minHeight: 400,
        title: "Sténo",
        titleBarStyle: "hiddenInset",
        backgroundColor: "#f3f2ef",
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
        },
    });
    mainWindow.loadFile(path.join(__dirname, "app.html"));

    // Fermer la fenêtre la cache seulement : le raccourci continue de marcher
    mainWindow.on("close", (e) => {
        if (!quitting) {
            e.preventDefault();
            mainWindow.hide();
        }
    });
}

function showOverlay(state) {
    clearTimeout(hideTimer);

    // Affiche la pastille sur l'écran où se trouve la souris, au-dessus de la pilule d'enregistrement si elle est là
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const recordingOffset = indicator?.isPillVisible() ? indicator.height : 0;
    overlay.setPosition(
        Math.round(workArea.x + (workArea.width - OVERLAY_WIDTH) / 2),
        Math.round(workArea.y + workArea.height - OVERLAY_HEIGHT - OVERLAY_MARGIN - recordingOffset)
    );

    overlay.webContents.executeJavaScript(`setState(${JSON.stringify(state)})`);
    overlay.showInactive();
}

// Hauteur des barres pendant la dictée, entre 0 et 1
function setOverlayLevel(level) {
    overlay.webContents.executeJavaScript(`setLevel(${Number(level) || 0})`);
}

function hideOverlay(delay) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
        overlay.webContents.executeJavaScript(`setState("hidden")`);
        // Laisse le temps à l'animation de disparition
        hideTimer = setTimeout(() => overlay.hide(), 200);
    }, delay);
}

// Simule Cmd+V dans l'application active, là où se trouve le curseur
function pasteAtCursor() {
    return new Promise((resolve, reject) => {
        execFile(
            "osascript",
            ["-e", 'tell application "System Events" to keystroke "v" using command down'],
            (error) => (error ? reject(error) : resolve())
        );
    });
}

// Colle un texte sans toucher au presse-papiers : son contenu est remis juste après le collage
async function pasteText(text) {
    const saved = { text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF(), image: clipboard.readImage() };
    clipboard.writeText(text);
    try {
        await pasteAtCursor();
        await wait(CLIPBOARD_RESTORE_DELAY_MS);
    } finally {
        const restored = Object.fromEntries(Object.entries(saved).filter(([, value]) => (typeof value === "string" ? value : !value.isEmpty())));
        if (Object.keys(restored).length > 0) clipboard.write(restored);
        else clipboard.clear();
    }
}

// Transcrit (si besoin) puis corrige un nouveau mémo Dictaphone, et l'ajoute à l'historique
async function processVoiceMemo(memo) {
    const startedAt = Date.now();
    const transcript = await getMemoText(memo, transcriptionModel);

    const entry = {
        id: `voice-${memo.id}`,
        source: "voice",
        memoTitle: memo.label || null,
        memoDuration: memo.duration,
        transcriptSource: transcript.source,
        date: memo.date,
        original: transcript.text,
        model,
    };

    // Mémo sans parole : rien à corriger
    if (!transcript.text.trim()) {
        addToHistory({ ...entry, corrected: "", durationMs: Date.now() - startedAt, cost: null, costStatus: "none" });
        return;
    }

    const correction = await correctText(transcript.text);
    const fullEntry = {
        ...entry,
        generationId: correction.generationId,
        corrected: correction.text,
        durationMs: Date.now() - startedAt,
        inputTokens: correction.usage?.prompt_tokens ?? 0,
        outputTokens: correction.usage?.completion_tokens ?? 0,
        cost: null,
        costStatus: "pending",
    };
    addToHistory(fullEntry);
    resolveCost(fullEntry);
}

function setVoiceStatus(status) {
    voiceStatus = status;
    mainWindow?.webContents.send("voice-status", status);
}

ipcMain.handle("get-history", () => readHistory());
ipcMain.handle("get-voice-status", () => voiceStatus);
ipcMain.handle("copy-text", (_event, text) => clipboard.writeText(text));
ipcMain.handle("get-dictionary", () => readDictionary());
ipcMain.handle("add-word", (_event, word) => addWord(word));
ipcMain.handle("remove-word", (_event, word) => removeWord(word));
ipcMain.handle("get-meetings", () => meetings.list());
ipcMain.handle("get-meeting", (_event, id) => meetings.get(id));
ipcMain.handle("rename-speaker", (_event, id, speaker, name) => meetings.renameSpeaker(id, speaker, name));
ipcMain.handle("delete-meeting", (_event, id) => meetings.remove(id));
ipcMain.handle("get-dictation-language", () => readSettings().dictationLanguage ?? DEFAULT_DICTATION_LANGUAGE);
ipcMain.handle("set-dictation-language", (_event, language) => updateSettings({ dictationLanguage: language }));

app.whenReady().then(() => {
    // Lancée avec `electron .`, l'app afficherait l'icône d'Electron dans le Dock
    if (process.platform === "darwin") {
        app.dock.setIcon(path.join(__dirname, "brand", "icon", "png", "steno-icon-1024.png"));
    }

    createOverlay();
    createMainWindow();

    // Reprend les coûts restés en attente (app quittée avant la réponse du Gateway)
    readHistory()
        .filter((entry) => entry.costStatus === "pending" && entry.generationId)
        .forEach(resolveCost);

    watchVoiceMemos({
        stateFile: path.join(app.getPath("userData"), "voice-memos-state.json"),
        onNewMemo: processVoiceMemo,
        onStatus: setVoiceStatus,
        // Rattrapage unique des mémos des 4 derniers jours
        backfillDays: 4,
        isImported: (memoId) => readHistory().some((entry) => entry.id === `voice-${memoId}`),
    });

    // Appels Slack, Teams et Google Meet : détection, enregistrement puis transcription
    indicator = createRecordingIndicator({
        settingsFile: settingsPath(),
        onStop: () => meetings.stopRecording(),
    });
    meetings = createMeetings({
        dir: path.join(app.getPath("userData"), "meetings"),
        model: meetingTranscriptionModel,
        indicator,
        onChange: (list) => mainWindow?.webContents.send("meetings-updated", list),
    });
    // Après un arrêt manuel, la fin de l'appel arrive sans enregistrement en cours : elle est ignorée
    callWatcher = watchCalls({
        onCallStart: (call) => meetings.startRecording(call),
        onCallEnd: () => meetings.stopRecording(),
    });

    // Dictée : Option droite maintenue, puis le texte est collé à la place du curseur
    dictation = watchDictation({
        model: dictationModel,
        getPhrases: readDictionary,
        getLanguage: () => readSettings().dictationLanguage ?? DEFAULT_DICTATION_LANGUAGE,
        // Jamais en même temps qu'une correction Cmd+O
        tryBegin: () => !busy && (busy = true),
        end: () => (busy = false),
        showOverlay,
        hideOverlay,
        setOverlayLevel,
        pasteText,
        onDictation: ({ text, durationMs, audioDurationSec, cost }) =>
            addToHistory({
                id: Date.now().toString(36),
                source: "dictation",
                date: new Date().toISOString(),
                original: text,
                corrected: text,
                durationMs,
                audioDurationSec,
                model: dictationModel,
                cost,
                costStatus: cost === null ? "unavailable" : "exact",
            }),
    });

    // Register global shortcut
    const shortcut = process.platform === "darwin" ? "Command+O" : "Control+O";

    const ret = globalShortcut.register(shortcut, async () => {
        console.log("Raccourci détecté !");

        // Ignore le raccourci si une correction est déjà en cours
        if (busy) return;

        const clipboardText = clipboard.readText();
        if (!clipboardText.trim()) return;

        busy = true;
        showOverlay("loading");
        const startedAt = Date.now();

        try {
            const correction = await correctText(clipboardText);
            clipboard.writeText(correction.text);

            if (process.platform === "darwin") {
                await pasteAtCursor();
            }

            const entry = {
                id: startedAt.toString(36),
                generationId: correction.generationId,
                date: new Date(startedAt).toISOString(),
                original: clipboardText,
                corrected: correction.text,
                durationMs: Date.now() - startedAt,
                model,
                inputTokens: correction.usage?.prompt_tokens ?? 0,
                outputTokens: correction.usage?.completion_tokens ?? 0,
                cost: null,
                costStatus: "pending",
            };
            addToHistory(entry);
            // En arrière-plan : ne retarde ni le collage ni la pastille
            resolveCost(entry);

            showOverlay("done");
            hideOverlay(800);
        } catch (error) {
            console.error("Échec de la correction ou du collage:", error);
            showOverlay("error");
            hideOverlay(2000);
        } finally {
            busy = false;
        }
    });

    if (!ret) {
        console.log("Échec de l'enregistrement du raccourci global");
    }

    console.log(`Application démarrée - raccourci ${shortcut} enregistré`);
});

// Clic sur l'icône du Dock : réaffiche la fenêtre
app.on("activate", () => {
    mainWindow?.show();
});

app.on("before-quit", () => {
    quitting = true;
});

// Gérer la fermeture propre de l'application
app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    // Les helpers natifs ne s'arrêtent pas seuls avec l'app
    callWatcher?.stop();
    meetings?.abort();
    dictation?.stop();
});

// Empêcher l'application de se fermer quand toutes les fenêtres sont fermées
app.on("window-all-closed", (e) => {
    e.preventDefault();
});
