// Enregistre les appels détectés (micro + son du Mac) puis les transcrit avec MAI-Transcribe-2 via le Gateway
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { pathToFileURL } = require("url");
const { spawn, execFile } = require("child_process");
const { transcribe, transcriptionCost } = require("./gateway-transcription");
const { helperCommand } = require("./native-helper");

// Opus mono : format accepté par MAI-Transcribe-2, et léger à envoyer
const OPUS = ["-ac", "1", "-c:a", "libopus", "-b:a", "24k"];

// Silence entre deux mots à partir duquel on coupe une phrase
const PAUSE_SECONDS = 1;

function run(command, args) {
    return new Promise((resolve, reject) => {
        execFile(command, args, { maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) =>
            error ? reject(new Error(stderr.trim() || error.message)) : resolve(stdout)
        );
    });
}

const ffmpeg = (args) => run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);

// Compresse les deux pistes, et les mixe en un seul fichier pour l'écoute
async function encodeAudio(dir) {
    const file = (name) => path.join(dir, name);
    await ffmpeg(["-i", file("mic.wav"), ...OPUS, file("mic.ogg")]);
    await ffmpeg(["-i", file("system.wav"), ...OPUS, file("system.ogg")]);
    await ffmpeg([
        "-i", file("mic.wav"),
        "-i", file("system.wav"),
        "-filter_complex", "amix=inputs=2:duration=longest:normalize=0",
        ...OPUS,
        file("call.ogg"),
    ]);
    fs.rmSync(file("mic.wav"));
    fs.rmSync(file("system.wav"));
}

// Azure renvoie une seule phrase par interlocuteur tant que personne d'autre ne parle sur la piste :
// on la coupe aux pauses grâce aux horodatages des mots, pour pouvoir intercaler les deux pistes.
// Les mots horodatés sont gardés pour surligner celui en cours pendant l'écoute
function splitAtPauses(phrase) {
    if (!phrase.words?.length) {
        const end = (phrase.offsetMilliseconds + phrase.durationMilliseconds) / 1000;
        return [{ speaker: phrase.speaker, start: phrase.offsetMilliseconds / 1000, end, text: phrase.text }];
    }

    const parts = [];
    for (const word of phrase.words) {
        const start = word.offsetMilliseconds / 1000;
        const end = (word.offsetMilliseconds + word.durationMilliseconds) / 1000;
        const timedWord = { text: word.text, start, end };
        const last = parts.at(-1);
        if (last && start - last.end < PAUSE_SECONDS) {
            last.text += ` ${word.text}`;
            last.end = end;
            last.words.push(timedWord);
        } else {
            parts.push({ speaker: phrase.speaker, start, end, text: word.text, words: [timedWord] });
        }
    }
    return parts;
}

// Phrases horodatées (en secondes). Le numéro de speaker n'existe que dans les métadonnées d'Azure
function toPhrases(result) {
    const phrases = result.providerMetadata?.azure?.phrases;
    if (phrases) return phrases.flatMap(splitAtPauses);
    if (result.segments?.length) {
        return result.segments.map((segment) => ({ start: segment.startSecond, end: segment.endSecond, text: segment.text }));
    }
    return result.text ? [{ start: 0, end: 0, text: result.text }] : [];
}

// Piste micro = « Moi » ; piste système = les autres, séparés par la diarisation.
// Les réponses de l'API sont gardées telles quelles (mic.json, system.json) : on peut refaire
// la mise en forme sans repayer la transcription
async function transcribeMeeting(dir, model) {
    const [micResult, systemResult] = await Promise.all([
        transcribe(path.join(dir, "mic.ogg"), model, { timestamps: "word" }),
        transcribe(path.join(dir, "system.ogg"), model, { timestamps: "word", diarization: { enabled: true } }),
    ]);
    fs.writeFileSync(path.join(dir, "mic.json"), JSON.stringify(micResult, null, 2));
    fs.writeFileSync(path.join(dir, "system.json"), JSON.stringify(systemResult, null, 2));

    return { ...buildTranscript(micResult, systemResult), cost: transcriptionCost([micResult, systemResult]) };
}


// Conversation affichée par l'app, construite à partir des deux réponses brutes de l'API
function buildTranscript(micResult, systemResult) {
    const phrases = [
        ...toPhrases(micResult).map((phrase) => ({ ...phrase, speaker: "me" })),
        ...toPhrases(systemResult).map((phrase) => ({ ...phrase, speaker: `s${phrase.speaker ?? 0}` })),
    ]
        .filter((phrase) => phrase.text.trim())
        .sort((a, b) => a.start - b.start);

    // Les phrases consécutives d'une même personne forment un seul bloc
    const utterances = [];
    for (const phrase of phrases) {
        const last = utterances.at(-1);
        if (last?.speaker === phrase.speaker) {
            last.text += ` ${phrase.text}`;
            last.end = phrase.end;
            last.words = last.words && phrase.words ? [...last.words, ...phrase.words] : undefined;
        } else {
            utterances.push({ ...phrase });
        }
    }

    const speakers = { me: "Moi" };
    for (const { speaker } of utterances) {
        if (!(speaker in speakers)) speakers[speaker] = `Interlocuteur ${Object.keys(speakers).length}`;
    }

    return { speakers, utterances };
}

function createMeetings({ dir, model, indicator, onChange }) {
    fs.mkdirSync(dir, { recursive: true });
    let recording = null;

    const meetingDir = (id) => path.join(dir, id);
    const read = (id) => JSON.parse(fs.readFileSync(path.join(meetingDir(id), "meeting.json"), "utf8"));

    // Liste sans les transcriptions complètes, pour garder les envois à la fenêtre légers
    function list() {
        return fs
            .readdirSync(dir)
            .flatMap((id) => {
                try {
                    const { utterances, speakers, ...summary } = read(id);
                    return [{ ...summary, preview: (utterances ?? []).map((u) => u.text).join(" ").slice(0, 200) }];
                } catch {
                    return [];
                }
            })
            .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    }

    function save(meeting) {
        fs.writeFileSync(path.join(meetingDir(meeting.id), "meeting.json"), JSON.stringify(meeting, null, 2));
        onChange(list());
    }

    function startRecording(call) {
        if (recording) return;

        const startedAt = new Date();
        const meeting = { id: startedAt.getTime().toString(36), app: call.bundleId, label: call.label, startedAt: startedAt.toISOString(), status: "recording" };
        fs.mkdirSync(meetingDir(meeting.id));
        save(meeting);

        const child = spawn(...helperCommand("record", "--out", meetingDir(meeting.id)));
        const current = { meeting, child, stopping: false, error: null };
        current.exited = new Promise((resolve) => child.on("close", resolve));
        recording = current;

        child.on("error", (error) => (current.error = `Helper d'enregistrement introuvable (lancer pnpm run build:native) : ${error.message}`));
        child.stderr.on("data", (data) => console.error("record:", data.toString().trim()));
        readline.createInterface({ input: child.stdout }).on("line", (line) => {
            let event;
            try {
                event = JSON.parse(line);
            } catch {
                return;
            }
            if (event.type === "level") indicator.setLevels(event);
            if (event.type === "error") {
                current.error = event.message;
                console.error("Enregistrement:", event.message);
            }
        });

        // Le helper s'arrête de lui-même seulement en cas d'échec (permission refusée, etc.)
        current.exited.then((code) => {
            if (current.stopping) return;
            if (recording === current) recording = null;
            save({ ...meeting, status: "error", error: current.error ?? `Le helper d'enregistrement s'est arrêté (code ${code})` });
            indicator.showResult(false);
        });

        indicator.showRecording(call.label, startedAt);
    }

    // Fin d'appel ou clic sur stop ; sans effet si rien n'est en cours d'enregistrement
    async function stopRecording() {
        if (!recording) return;
        const { meeting, child, exited } = recording;
        recording.stopping = true;
        recording = null;

        child.kill("SIGTERM");
        await exited;

        const endedAt = new Date();
        let updated = {
            ...meeting,
            endedAt: endedAt.toISOString(),
            durationSec: Math.round((endedAt - new Date(meeting.startedAt)) / 1000),
            status: "processing",
        };
        save(updated);
        indicator.showProcessing();

        try {
            await encodeAudio(meetingDir(meeting.id));
            updated = { ...updated, ...(await transcribeMeeting(meetingDir(meeting.id), model)), status: "done" };
            indicator.showResult(true);
        } catch (error) {
            console.error("Échec du traitement de la réunion:", error);
            updated = { ...updated, status: "error", error: error.message };
            indicator.showResult(false);
        }
        save(updated);
    }

    function get(id) {
        const meeting = read(id);
        const audio = path.join(meetingDir(id), "call.ogg");
        return { ...meeting, audioUrl: fs.existsSync(audio) ? pathToFileURL(audio).href : null };
    }

    function renameSpeaker(id, speaker, name) {
        const meeting = read(id);
        if (name.trim()) meeting.speakers[speaker] = name.trim();
        save(meeting);
        return get(id);
    }

    function remove(id) {
        if (recording?.meeting.id === id) return;
        fs.rmSync(meetingDir(id), { recursive: true, force: true });
        onChange(list());
    }

    // À la fermeture de l'app : le helper ne doit pas continuer à tenir le micro
    function abort() {
        recording?.child.kill("SIGTERM");
    }

    return { startRecording, stopRecording, list, get, renameSpeaker, remove, abort };
}

module.exports = { createMeetings };
