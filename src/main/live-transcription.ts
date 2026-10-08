// Mode rapide de la dictée : le son part pendant qu'on parle (transcription en direct via le Gateway),
// le texte final arrive environ 0,2 s après la fin du son au lieu de 2 à 3 s
import { experimental_streamTranscribe as streamTranscribe } from "ai";
import { createGateway } from "@ai-sdk/gateway";

// Le modèle ne renvoie pas son coût : tarif mesuré sur le solde du Gateway le 2026-10-08, à la seconde entamée
const COST_PER_SECOND = 0.54 / 3600;
// Au-delà, le texte final n'arrivera plus : la dictée repasse en transcription normale
const FINAL_TIMEOUT_MS = 5000;
// Son envoyé par le helper : PCM 16 bits mono à 24 kHz
const BYTES_PER_SECOND = 24_000 * 2;
// Silence envoyé au modèle après la fin du son : sans lui, il laisse parfois tomber le dernier mot (mesuré le 2026-10-08).
// Rien n'est enregistré après le relâchement, et le silence part d'un coup, sans attente
const TRAILING_SILENCE_SECONDS = 0.3;

export type LiveTranscription = {
    // Morceau de son reçu du helper (événement "audio", en base64)
    push: (pcm: string) => void;
    // Fin du son : renvoie le texte final, ou échoue si le mode rapide n'a rien donné
    finish: () => Promise<{ text: string; cost: number }>;
    abort: () => void;
};

export function startLiveTranscription(model: string): LiveTranscription {
    const gateway = createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY });
    const aborter = new AbortController();
    let audio!: ReadableStreamDefaultController<Uint8Array>;
    let bytes = 0;

    const result = streamTranscribe({
        model: gateway.transcriptionModel(model),
        audio: new ReadableStream<Uint8Array>({ start: (controller) => void (audio = controller) }),
        inputAudioFormat: { type: "audio/pcm", rate: 24_000 },
        abortSignal: aborter.signal,
    });

    // Le flux est lu dès l'ouverture : les textes partiels arrivent pendant qu'on parle
    const finalText = (async () => {
        const finals: string[] = [];
        for await (const part of result.fullStream) {
            if (part.type === "transcript-final") finals.push(part.text);
            // La préversion renvoie souvent une erreur à la fermeture, après le texte final : seule une erreur avant compte
            if (part.type === "error" && finals.length === 0) throw part.error;
        }
        if (finals.length === 0) throw new Error("aucun texte reçu");
        return finals.join(" ");
    })();
    // Sans finish (dictée annulée ou trop courte), l'échec n'est attendu par personne
    finalText.catch(() => {});

    // Le SDK ferme le flux si la session a déjà échoué : finish basculera alors sur la transcription normale
    function send(chunk: Uint8Array) {
        bytes += chunk.length;
        try {
            audio.enqueue(chunk);
        } catch {}
    }

    function closeAudio() {
        try {
            audio.close();
        } catch {}
    }

    return {
        push(pcm) {
            send(new Uint8Array(Buffer.from(pcm, "base64")));
        },
        async finish() {
            send(new Uint8Array(Math.round(TRAILING_SILENCE_SECONDS * BYTES_PER_SECOND)));
            closeAudio();
            let timer: NodeJS.Timeout | undefined;
            const timeout = new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`pas de texte final après ${FINAL_TIMEOUT_MS / 1000} s`)), FINAL_TIMEOUT_MS);
            });
            try {
                const text = await Promise.race([finalText, timeout]);
                return { text, cost: Math.ceil(bytes / BYTES_PER_SECOND) * COST_PER_SECOND };
            } catch (error) {
                aborter.abort();
                throw error;
            } finally {
                clearTimeout(timer);
            }
        },
        abort() {
            aborter.abort();
            closeAudio();
        },
    };
}

// Retire les « euh » et « heu » : le mode normal les enlève déjà (style « clean »), le mode rapide ne le propose pas
export function removeFillers(text: string) {
    return (
        text
            // En début de phrase, la phrase reprend sa majuscule
            .replace(/(^|(?<!\.)[.!?]\s+)(?:euh+|heu+)(?!\p{L})[\s,…]*(?:\.\.\.)?\s*(\p{Ll})/giu, (_, before: string, letter: string) => before + letter.toUpperCase())
            // Ailleurs, avec la virgule ou les points de suspension qui le suivent
            .replace(/\s*(?<!\p{L})(?:euh+|heu+)(?!\p{L})(?:\s*(?:,|…|\.\.\.))?/giu, "")
            .trim()
    );
}
