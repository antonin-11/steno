// Transcription d'un fichier audio avec MAI-Transcribe-2, via le Vercel AI Gateway (réunions et dictée)
import fs from "fs";
import path from "path";

const TRANSCRIPTION_URL = "https://ai-gateway.vercel.sh/v4/ai/transcription-model";
// Un long appel peut prendre plusieurs minutes à transcrire
const TRANSCRIPTION_TIMEOUT_MS = 15 * 60_000;

const MEDIA_TYPES: Record<string, string> = { ".ogg": "audio/ogg", ".wav": "audio/wav" };

// Mot horodaté renvoyé par Azure
export type AzureWord = { text: string; offsetMilliseconds: number; durationMilliseconds: number };
export type AzurePhrase = AzureWord & { speaker?: number; words?: AzureWord[] };

// Réponse du Gateway (seuls les champs utilisés par Sténo)
export type TranscriptionResult = {
    text: string;
    segments?: { text: string; startSecond: number; endSecond: number }[];
    providerMetadata?: {
        gateway?: { cost?: unknown };
        azure?: { phrases?: AzurePhrase[] };
    };
};

export async function transcribe(file: string, model: string, azureOptions: Record<string, unknown>): Promise<TranscriptionResult> {
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
            audio: fs.readFileSync(file).toString("base64"),
            mediaType: MEDIA_TYPES[path.extname(file)],
            providerOptions: { azure: azureOptions },
        }),
        signal: AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS),
    });

    if (!response.ok) {
        throw new Error(`transcription HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    return response.json();
}

// Coût total en dollars : le Gateway l'indique dans chaque réponse
export function transcriptionCost(results: TranscriptionResult[]): number | null {
    const costs = results.map((result) => Number(result.providerMetadata?.gateway?.cost));
    return costs.every(Number.isFinite) ? costs.reduce((sum, cost) => sum + cost, 0) : null;
}
