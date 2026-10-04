// Récupère les nouveaux mémos de l'app Dictaphone (Voice Memos) et leur texte
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const RECORDINGS_DIR = path.join(os.homedir(), "Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings");
const DATABASE = path.join(RECORDINGS_DIR, "CloudRecordings.db");

// Les dates Core Data comptent à partir du 1er janvier 2001
const APPLE_EPOCH_OFFSET = 978307200;

const SCAN_INTERVAL_MS = 30_000;
const WATCH_DEBOUNCE_MS = 1500;
// Un fichier dont la taille ne bouge plus pendant ce délai est considéré comme fini d'écrire
const FILE_STABLE_MS = 2000;
const MAX_ATTEMPTS = 3;

const TRANSCRIPTION_URL = "https://ai-gateway.vercel.sh/v4/ai/transcription-model";
const TRANSCRIPTION_TIMEOUT_MS = 120_000;

function run(command, args) {
    return new Promise((resolve, reject) => {
        execFile(command, args, { maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) =>
            error ? reject(new Error(stderr.trim() || error.message)) : resolve(stdout)
        );
    });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Lecture seule : on ne modifie jamais la base de Dictaphone
async function listMemos() {
    const output = await run("sqlite3", [
        "-readonly",
        "-json",
        DATABASE,
        `SELECT ZUNIQUEID AS id, ZPATH AS path, ZDURATION AS duration, ZCUSTOMLABEL AS label,
                ZDATE + ${APPLE_EPOCH_OFFSET} AS timestamp
         FROM ZCLOUDRECORDING
         WHERE ZUNIQUEID IS NOT NULL AND ZPATH IS NOT NULL
         ORDER BY ZDATE`,
    ]);
    if (!output.trim()) return [];

    return JSON.parse(output).map((memo) => ({
        ...memo,
        file: path.isAbsolute(memo.path) ? memo.path : path.join(RECORDINGS_DIR, memo.path),
        date: new Date(memo.timestamp * 1000).toISOString(),
    }));
}

// Transcription faite par Apple, rangée dans un bloc "tsrp" du fichier audio
function readAppleTranscript(file) {
    const data = fs.readFileSync(file);
    const index = data.indexOf("tsrp");
    if (index < 4) return null;

    try {
        const size = data.readUInt32BE(index - 4);
        const json = JSON.parse(data.subarray(index + 4, index - 4 + size).toString("utf8"));
        // "runs" alterne morceaux de texte et numéros d'attributs
        const text = json.attributedString.runs.filter((run) => typeof run === "string").join("");
        return text.trim() || null;
    } catch {
        return null;
    }
}

// Convertit le mémo (.qta ou .m4a) en .m4a AAC simple, accepté par les modèles de transcription
async function convertToM4a(file) {
    const output = path.join(os.tmpdir(), `steno-${path.basename(file, path.extname(file))}.m4a`);
    await run("avconvert", ["--source", file, "--preset", "PresetAppleM4A", "--output", output, "--replace"]);
    return output;
}

async function transcribe(file, model) {
    const audioFile = await convertToM4a(file);
    try {
        const response = await fetch(TRANSCRIPTION_URL, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}`,
                "ai-gateway-protocol-version": "0.0.1",
                "ai-transcription-model-specification-version": "4",
                "ai-model-id": model,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                audio: fs.readFileSync(audioFile).toString("base64"),
                mediaType: "audio/mp4",
            }),
            signal: AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS),
        });

        if (!response.ok) {
            throw new Error(`transcription HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
        }
        return (await response.json()).text;
    } finally {
        fs.rmSync(audioFile, { force: true });
    }
}

// Texte du mémo : transcription d'Apple si elle existe (gratuite), sinon transcription via le Gateway
async function getMemoText(memo, model) {
    const appleText = readAppleTranscript(memo.file);
    if (appleText) return { text: appleText, source: "apple" };

    return { text: await transcribe(memo.file, model), source: "api" };
}

async function isFileStable(file) {
    const before = fs.statSync(file).size;
    await wait(FILE_STABLE_MS);
    return before > 0 && fs.statSync(file).size === before;
}

/**
 * Surveille Dictaphone et appelle onNewMemo pour chaque mémo enregistré après le premier lancement.
 * Au tout premier lancement, les mémos existants sont notés comme déjà vus et ignorés.
 * Une seule fois, les mémos des `backfillDays` derniers jours sont rattrapés (sauf ceux déjà importés).
 */
function watchVoiceMemos({ stateFile, onNewMemo, onStatus, backfillDays = 0, isImported = () => false }) {
    let known = null;
    let backfillDone = false;
    let scanning = false;
    let rescanRequested = false;
    const attempts = new Map();

    function saveState() {
        fs.writeFileSync(stateFile, JSON.stringify({ known: [...known], backfillDone }, null, 2));
    }

    async function scan() {
        if (scanning) {
            rescanRequested = true;
            return;
        }
        scanning = true;

        try {
            const memos = await listMemos();
            onStatus({ available: true });

            if (known === null) {
                try {
                    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
                    known = new Set(state.known);
                    backfillDone = Boolean(state.backfillDone);
                } catch {
                    // Premier lancement : on ignore tout l'historique existant
                    known = new Set(memos.map((memo) => memo.id));
                }

                // Rattrapage unique : remet en file les mémos récents pas encore importés
                if (!backfillDone && backfillDays > 0) {
                    const since = Date.now() - backfillDays * 24 * 60 * 60 * 1000;
                    const recent = memos.filter((memo) => new Date(memo.date).getTime() >= since && !isImported(memo.id));
                    recent.forEach((memo) => known.delete(memo.id));
                    console.log(`Rattrapage : ${recent.length} mémo(s) des ${backfillDays} derniers jours à importer`);
                    backfillDone = true;
                }
                saveState();
            }

            for (const memo of memos) {
                if (known.has(memo.id)) continue;
                // Fichier encore dans iCloud, ou enregistrement pas encore fini
                if (!fs.existsSync(memo.file) || !(memo.duration > 0)) continue;
                if (!(await isFileStable(memo.file))) continue;

                try {
                    await onNewMemo(memo);
                    known.add(memo.id);
                } catch (error) {
                    const count = (attempts.get(memo.id) ?? 0) + 1;
                    attempts.set(memo.id, count);
                    console.error(`Mémo ${memo.path} : essai ${count}/${MAX_ATTEMPTS} échoué :`, error.message);
                    // Abandon après plusieurs échecs, pour ne pas réessayer (et payer) indéfiniment
                    if (count >= MAX_ATTEMPTS) known.add(memo.id);
                }
                saveState();
            }
        } catch (error) {
            const denied = /authorization denied|not permitted|unable to open/i.test(error.message);
            onStatus({ available: false, error: denied ? "permission" : error.message });
            if (!denied) console.error("Lecture de Dictaphone impossible :", error.message);
        } finally {
            scanning = false;
            if (rescanRequested) {
                rescanRequested = false;
                scan();
            }
        }
    }

    let debounce = null;
    try {
        const watcher = fs.watch(RECORDINGS_DIR, () => {
            clearTimeout(debounce);
            debounce = setTimeout(scan, WATCH_DEBOUNCE_MS);
        });
        // Sans ce gestionnaire, une erreur du dossier surveillé ferait planter l'app
        watcher.on("error", () => {});
    } catch {
        // Pas d'accès au dossier : le scan périodique signalera l'erreur
    }
    setInterval(scan, SCAN_INTERVAL_MS);
    scan();
}

module.exports = { watchVoiceMemos, getMemoText, readAppleTranscript, RECORDINGS_DIR };
