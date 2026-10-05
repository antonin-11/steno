// Animations de la pastille : lettres qui défilent pendant la correction, vague du logo qui ondule
// avec la voix pendant la dictée, puis qui s'enroule en rond de chargement pendant la transcription.
// L'état est posé en classes sur `root` (visible, listening, loading, done, error, curl), que lit le CSS
import type { OverlayState } from "../../../shared/types";

const STATE_CLASSES = ["visible", "listening", "loading", "done", "error", "curl"];

const LETTER_COUNT = 6;
const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
// Durée du remplacement d'une lettre, et décalage avant de lancer la suivante
const SWAP_DURATION = 320;
const STEP_DELAY = 160;

// Vague du logo (brand/logo/steno-logo.svg) : 1,5 période, amplitude de 6 pour 46 de long
const WAVE_WIDTH = 32;
const WAVE_HEIGHT = 14;
const WAVE_STROKE = 4.4;
const WAVE_LENGTH = WAVE_WIDTH - WAVE_STROKE;
const LOGO_AMPLITUDE = (WAVE_LENGTH * 6) / 46;

// Fin de la dictée : la vague s'enroule en un rond de chargement qui tourne,
// et la pilule se resserre en cercle autour de lui
const CURL_DURATION = 0.6;
const ROUND_PILL = 34;
const RING_RADIUS = 7;
// Arc de 290° au moment où il se referme, qui respire ensuite jusqu'à 255° en tournant à un tour par seconde
const RING_SWEEP = (290 * Math.PI) / 180;
const RING_BREATH = (35 * Math.PI) / 180;
const BREATH_PERIOD = 1.8;
const SPIN_SPEED = 2 * Math.PI;
// Le trait est vu comme une suite de petits pas de même longueur. La tête de la vague (à droite,
// là où elle avance) s'enroule la première et le reste suit, avec ce décalage sur la durée totale.
const STEPS = 48;
const STAGGER = 0.35;

type Point = [number, number];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (t: number) => Math.min(1, Math.max(0, t));
const toPath = (points: Point[]) => `M${points.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join("L")}`;

// Même calcul que cubic-bezier() en CSS
function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
    const curve = (a: number, b: number, t: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
    return (x: number) => {
        let low = 0;
        let high = 1;
        let t = x;
        for (let i = 0; i < 24; i++) {
            if (curve(x1, x2, t) < x) low = t;
            else high = t;
            t = (low + high) / 2;
        }
        return curve(y1, y2, t);
    };
}

// Départ en douceur, longue arrivée : la rotation prend le relais sans à-coup
const ease = cubicBezier(0.45, 0, 0.2, 1);

// STEPS + 1 points régulièrement espacés le long du tracé
function resample(points: Point[]) {
    const lengths = [0];
    for (let i = 1; i < points.length; i++) {
        lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    }
    const total = lengths[lengths.length - 1];
    const samples: Point[] = [];
    let j = 0;
    for (let i = 0; i <= STEPS; i++) {
        const at = (total * i) / STEPS;
        while (j < points.length - 2 && lengths[j + 1] < at) j++;
        const k = (at - lengths[j]) / (lengths[j + 1] - lengths[j] || 1);
        samples.push([lerp(points[j][0], points[j + 1][0], k), lerp(points[j][1], points[j + 1][1], k)]);
    }
    return samples;
}

// Centre de gravité du trait, chaque pas pesant sa longueur
function centroid(points: Point[]): Point {
    let weight = 0;
    let x = 0;
    let y = 0;
    for (let i = 1; i < points.length; i++) {
        const w = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
        weight += w;
        x += (w * (points[i - 1][0] + points[i][0])) / 2;
        y += (w * (points[i - 1][1] + points[i][1])) / 2;
    }
    return [x / weight, y / weight];
}

export function createOverlayAnimation({ root, pill, letters, wavePath }: { root: HTMLElement; pill: HTMLElement; letters: HTMLElement; wavePath: SVGPathElement }) {
    const slots: HTMLElement[] = [];
    let cycleId = 0;

    function setClasses(names: string) {
        root.classList.remove(...STATE_CLASSES);
        if (names) root.classList.add(...names.split(" "));
    }

    function randomLetter() {
        return ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }

    function createChar() {
        const char = document.createElement("span");
        char.className = "absolute inset-0 text-center leading-4";
        char.textContent = randomLetter();
        return char;
    }

    for (let i = 0; i < LETTER_COUNT; i++) {
        const slot = document.createElement("span");
        // Chaque lettre a sa case : l'ancienne sort par le bas, la nouvelle entre par le haut
        slot.className = "relative h-4 w-[1ch] overflow-hidden";
        slot.appendChild(createChar());
        letters.appendChild(slot);
        slots.push(slot);
    }

    // Fait sortir la lettre actuelle par le bas et entrer une nouvelle par le haut
    function swap(slot: HTMLElement) {
        const oldChar = slot.lastElementChild!;
        const newChar = createChar();
        slot.appendChild(newChar);

        const options: KeyframeAnimationOptions = { duration: SWAP_DURATION, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" };
        oldChar
            .animate([{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(100%)", opacity: 0 }], options)
            .finished.then(() => oldChar.remove());
        return newChar.animate([{ transform: "translateY(-100%)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], options).finished;
    }

    // Cascade de gauche à droite ; le cycle suivant attend que la dernière lettre ait fini
    async function runCycle(id: number) {
        while (id === cycleId) {
            const swaps: Promise<Animation>[] = [];
            for (const slot of slots) {
                if (id !== cycleId) return;
                swaps.push(swap(slot));
                await wait(STEP_DELAY);
            }
            await Promise.all(swaps);
        }
    }

    let level = 0;
    let smoothLevel = 0;
    let phase = 0;
    let lastFrame: number | null = null;
    let waveFrame: number | null = null;

    function wavePoints(amplitude: number, steps: number) {
        const points: Point[] = [];
        for (let i = 0; i <= steps; i++) {
            const u = i / steps;
            points.push([WAVE_STROKE / 2 + u * WAVE_LENGTH, WAVE_HEIGHT / 2 - amplitude * Math.sin(u * 3 * Math.PI - phase)]);
        }
        return points;
    }

    function drawWave(amplitude: number) {
        wavePath.setAttribute("d", toPath(wavePoints(amplitude, 48)));
    }

    // Pendant l'enroulement puis la rotation
    let curl: { start: number | null; width: number; spin: number } | null = null;

    // Morphing au fil du trait (comme ribbonMorph dans logo-morph.ts) : chaque petit pas tourne
    // de sa direction dans la vague à celle qu'il a dans l'arc, puis on remet les pas bout à bout.
    // Le trait se courbe comme un ruban qui s'enroule, au lieu de s'écraser.
    function drawCurl(now: number, elapsed: number, amplitude: number) {
        const current = curl!;
        if (current.start === null) current.start = now;
        const time = (now - current.start) / 1000;
        const progress = Math.min(1, time / CURL_DURATION);
        const settled = ease(progress);
        // La rotation s'amorce pendant l'enroulement et accélère avec lui : pas d'arrêt puis de départ
        current.spin += SPIN_SPEED * settled * elapsed;
        // L'arc est le plus ouvert quand il se referme, puis il respire
        const sweep = RING_SWEEP - (RING_BREATH * (1 - Math.cos((2 * Math.PI * (time - CURL_DURATION)) / BREATH_PERIOD))) / 2;
        const ringStep = 2 * RING_RADIUS * Math.sin(sweep / STEPS / 2);

        const samples = resample(wavePoints(amplitude, 96));
        const points: Point[] = [[0, 0]];
        for (let i = 0; i < STEPS; i++) {
            const along = (i + 0.5) / STEPS;
            const [a, b] = [samples[i], samples[i + 1]];
            const local = clamp((progress - STAGGER * (1 - along)) / (1 - STAGGER));
            const bend = ease(local);
            // Chaque morceau cesse d'onduler à mesure qu'il s'enroule : la queue ondule encore quand la tête tourne déjà
            const calm = ease(Math.min(1, local / 0.75));
            // L'arc a son milieu en haut : la vague se cambre et ses bouts descendent l'un vers l'autre
            const heading = (1 - calm) * Math.atan2(b[1] - a[1], b[0] - a[0]) + bend * (along - 0.5) * sweep + current.spin;
            const length = lerp(Math.hypot(b[0] - a[0], b[1] - a[1]), ringStep, bend);
            const [x, y] = points[i];
            points.push([x + length * Math.cos(heading), y + length * Math.sin(heading)]);
        }

        // Le trait glisse du centre de gravité de la vague à celui de l'arc, dont le cercle est au centre de la pilule
        const offset = (RING_RADIUS * Math.sin(sweep / 2)) / (STEPS * Math.tan(sweep / STEPS / 2));
        const [fromX, fromY] = centroid(samples);
        const [cx, cy] = centroid(points);
        const dx = lerp(fromX, WAVE_WIDTH / 2 + offset * Math.sin(current.spin), settled) - cx;
        const dy = lerp(fromY, WAVE_HEIGHT / 2 - offset * Math.cos(current.spin), settled) - cy;
        wavePath.setAttribute("d", toPath(points.map(([x, y]) => [x + dx, y + dy])));
        pill.style.width = `${lerp(current.width, ROUND_PILL, settled)}px`;
    }

    // La vague avance en continu ; la voix la fait monter jusqu'à l'amplitude du logo et l'accélère
    function wave(now: number) {
        const elapsed = lastFrame === null ? 0 : Math.min(0.1, (now - lastFrame) / 1000);
        lastFrame = now;
        // Le niveau n'arrive que toutes les 100 ms : on le lisse, vite à la montée, plus doucement à la descente
        smoothLevel += (level - smoothLevel) * Math.min(1, elapsed * (level > smoothLevel ? 18 : 6));
        phase += elapsed * (5 + 12 * smoothLevel);
        const amplitude = LOGO_AMPLITUDE * (0.45 + 0.85 * smoothLevel);
        if (curl) drawCurl(now, elapsed, amplitude);
        else drawWave(amplitude);
        waveFrame = requestAnimationFrame(wave);
    }

    // Arrête la boucle d'animation et rend à la pilule sa largeur naturelle
    function stopWave() {
        if (waveFrame !== null) cancelAnimationFrame(waveFrame);
        waveFrame = null;
        curl = null;
        pill.style.width = "";
    }

    let currentState: OverlayState = "hidden";

    // Envoyé par le processus principal : "listening", "loading", "done", "error" ou "hidden"
    function setState(state: OverlayState) {
        const previous = currentState;
        currentState = state;
        cycleId++;
        const id = cycleId;

        // Transcription d'une dictée : la vague continue sur sa lancée et s'enroule.
        // La correction (Cmd+O) arrive directement en "loading" et garde ses lettres.
        if (state === "loading" && waveFrame !== null && (previous === "listening" || previous === "loading")) {
            if (!curl) {
                level = 0;
                curl = { start: null, width: pill.offsetWidth, spin: 0 };
            }
            setClasses("visible loading curl");
            return;
        }
        // Le rond continue de tourner pendant que la bulle s'efface
        if (state === "hidden" && curl) {
            setClasses("curl");
            setTimeout(() => {
                if (id === cycleId) {
                    stopWave();
                    setClasses("");
                }
            }, 250);
            return;
        }

        setClasses(state === "hidden" ? "" : `visible ${state}`);
        // Une seule boucle d'animation à la fois, même si "listening" arrive deux fois
        if (state === "listening" && (waveFrame === null || curl)) {
            stopWave();
            level = smoothLevel = phase = 0;
            lastFrame = null;
            drawWave(LOGO_AMPLITUDE * 0.45);
            waveFrame = requestAnimationFrame(wave);
        } else if (state !== "listening") {
            stopWave();
        }

        if (state === "loading") {
            runCycle(id);
        }
    }

    return {
        setState,
        // Niveau de la voix pendant la dictée, entre 0 et 1
        setLevel(value: number) {
            level = value;
        },
        // Arrête les animations et retire les lettres (la page se recharge, ou React démonte la pastille)
        dispose() {
            cycleId++;
            stopWave();
            letters.replaceChildren();
        },
    };
}
