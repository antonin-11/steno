// Détecte le début et la fin d'un appel Slack, Teams ou Google Meet à partir des apps qui utilisent le micro
import readline from "readline";
import { spawn, execFile } from "child_process";
import { RECORDER } from "./native-helper";

// L'app doit utiliser le micro depuis ce délai pour qu'on considère qu'un appel a commencé
const START_DELAY_MS = 5000;
// L'appel est fini quand l'app n'utilise plus ni le micro ni la sortie audio pendant ce délai
const END_DELAY_MS = 5000;
// Ou, pour Slack, quand sa connexion WebRTC reste fermée pendant ce délai : une coupure réseau la ferme quelques secondes
const WEBRTC_END_DELAY_MS = 30000;
// Délai minimum entre deux lectures des onglets d'un même navigateur
const TAB_CHECK_INTERVAL_MS = 5000;

const CALL_APPS: Record<string, string> = {
    "com.tinyspeck.slackmacgap": "Slack",
    "com.microsoft.teams2": "Teams",
    "com.microsoft.teams": "Teams",
};

// Slack peut ouvrir le micro hors de tout huddle et le garder des heures. Un huddle passe par une connexion WebRTC :
// sans elle, Slack sur le micro n'est pas un appel
const WEBRTC_APPS = new Set(["com.tinyspeck.slackmacgap"]);

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

// App qui utilise le micro (input) ou la sortie audio (output), et qui a ou non une connexion WebRTC établie, d'après le helper
type AudioApp = { bundleId: string; input: boolean; output: boolean; webrtc: boolean };

export type Call = { bundleId: string; label: string };

// Réunion ouverte dans un des onglets du navigateur, ou null
function findMeetingTab(bundleId: string): Promise<string | null> {
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

export function watchCalls({ onCallStart, onCallEnd }: { onCallStart: (call: Call) => void; onCallEnd: () => void }) {
    let apps: AudioApp[] = [];
    // Depuis quand chaque app utilise le micro sans interruption
    const micSince = new Map<string, number>();
    const lastTabCheck = new Map<string, number>();
    let call: Call | null = null;
    let quietSince: number | null = null;
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

    async function findCall(now: number): Promise<Call | null> {
        for (const [bundleId, since] of micSince) {
            if (now - since < START_DELAY_MS) continue;

            if (CALL_APPS[bundleId]) {
                if (WEBRTC_APPS.has(bundleId) && !apps.find((app) => app.bundleId === bundleId)?.webrtc) continue;
                return { bundleId, label: CALL_APPS[bundleId] };
            }

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
            const { bundleId } = call;
            const app = apps.find((a) => a.bundleId === bundleId);
            const usesAudio = !!app && (app.input || app.output);
            if (usesAudio && (app?.webrtc || !WEBRTC_APPS.has(bundleId))) {
                quietSince = null;
            } else if (quietSince === null) {
                quietSince = now;
            } else if (now - quietSince >= (usesAudio ? WEBRTC_END_DELAY_MS : END_DELAY_MS)) {
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
