// Détecte le début et la fin d'un appel Slack, Teams ou Google Meet à partir des apps qui utilisent le micro
const path = require("path");
const readline = require("readline");
const { spawn, execFile } = require("child_process");

const RECORDER = path.join(__dirname, "bin", "steno-recorder");

// L'app doit utiliser le micro depuis ce délai pour qu'on considère qu'un appel a commencé
const START_DELAY_MS = 5000;
// L'appel est fini quand l'app n'utilise plus ni le micro ni la sortie audio pendant ce délai
const END_DELAY_MS = 5000;
// Délai minimum entre deux lectures des onglets d'un même navigateur
const TAB_CHECK_INTERVAL_MS = 5000;

const CALL_APPS = {
    "com.tinyspeck.slackmacgap": "Slack",
    "com.microsoft.teams2": "Teams",
    "com.microsoft.teams": "Teams",
};

// Navigateurs Chromium : leurs onglets se lisent tous avec le même AppleScript
const BROWSERS = new Set([
    "com.google.Chrome",
    "company.thebrowser.Browser", // Arc
    "company.thebrowser.dia",
    "ai.perplexity.comet",
    "com.brave.Browser",
    "com.microsoft.edgemac",
]);

const MEETING_URLS = [
    { label: "Google Meet", pattern: /https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/ },
    { label: "Teams", pattern: /https:\/\/teams\.(microsoft\.com|live\.com|cloud\.microsoft)\// },
    { label: "Slack", pattern: /https:\/\/app\.slack\.com\// },
];

// Réunion ouverte dans un des onglets du navigateur, ou null
function findMeetingTab(bundleId) {
    return new Promise((resolve) => {
        execFile("osascript", ["-e", `tell application id "${bundleId}" to get URL of every tab of every window`], (error, stdout) => {
            if (error) {
                console.error(`Lecture des onglets impossible (${bundleId}):`, error.message.trim());
                return resolve(null);
            }
            resolve(MEETING_URLS.find(({ pattern }) => pattern.test(stdout))?.label ?? null);
        });
    });
}

function watchCalls({ onCallStart, onCallEnd }) {
    let apps = [];
    // Depuis quand chaque app utilise le micro sans interruption
    const micSince = new Map();
    const lastTabCheck = new Map();
    let call = null;
    let quietSince = null;
    let checkingTabs = false;

    const detector = spawn(RECORDER, ["detect"]);
    detector.on("error", (error) => console.error("Helper de détection introuvable (lancer pnpm run build:native):", error.message));
    detector.on("exit", (code) => code !== null && console.error(`Helper de détection arrêté (code ${code})`));
    detector.stderr.on("data", (data) => console.error("detect:", data.toString().trim()));

    readline.createInterface({ input: detector.stdout }).on("line", (line) => {
        try {
            apps = JSON.parse(line).apps ?? [];
        } catch {
            return;
        }

        const now = Date.now();
        for (const app of apps) {
            if (app.input && !micSince.has(app.bundleId)) micSince.set(app.bundleId, now);
        }
        for (const bundleId of micSince.keys()) {
            if (!apps.some((app) => app.bundleId === bundleId && app.input)) micSince.delete(bundleId);
        }
    });

    async function findCall(now) {
        for (const [bundleId, since] of micSince) {
            if (now - since < START_DELAY_MS) continue;

            if (CALL_APPS[bundleId]) return { bundleId, label: CALL_APPS[bundleId] };

            if (BROWSERS.has(bundleId) && now - (lastTabCheck.get(bundleId) ?? 0) >= TAB_CHECK_INTERVAL_MS) {
                lastTabCheck.set(bundleId, now);
                const label = await findMeetingTab(bundleId);
                if (label) return { bundleId, label };
            }
        }
        return null;
    }

    async function tick() {
        const now = Date.now();

        if (call) {
            const app = apps.find((a) => a.bundleId === call.bundleId);
            if (app && (app.input || app.output)) {
                quietSince = null;
            } else if (quietSince === null) {
                quietSince = now;
            } else if (now - quietSince >= END_DELAY_MS) {
                console.log(`Fin d'appel détectée : ${call.label}`);
                call = null;
                quietSince = null;
                onCallEnd();
            }
            return;
        }

        // La lecture des onglets est asynchrone : une seule à la fois
        if (checkingTabs) return;
        checkingTabs = true;
        try {
            const found = await findCall(now);
            if (found && !call) {
                call = found;
                console.log(`Appel détecté : ${found.label} (${found.bundleId})`);
                onCallStart(found);
            }
        } finally {
            checkingTabs = false;
        }
    }

    const timer = setInterval(tick, 1000);

    return {
        stop() {
            clearInterval(timer);
            detector.kill();
        },
    };
}

module.exports = { watchCalls };
