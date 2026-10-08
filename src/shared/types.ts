// Données échangées entre le processus principal et les fenêtres

// Une correction (Cmd+O), une dictée ou un mémo vocal, tel qu'enregistré dans history.json
export type HistoryEntry = {
    id: string;
    // Absent pour les corrections
    source?: "voice" | "dictation";
    date: string;
    original: string;
    corrected: string;
    durationMs?: number;
    model?: string;
    // Identifiant de génération du Gateway, pour récupérer le coût exact
    generationId?: string;
    inputTokens?: number;
    outputTokens?: number;
    cost: number | null;
    // "estimated" : mode rapide de la dictée, dont le Gateway ne renvoie pas le coût
    costStatus: "pending" | "exact" | "estimated" | "unavailable" | "none";
    provider?: string;
    // Mémos vocaux
    memoTitle?: string | null;
    memoDuration?: number;
    transcriptSource?: "apple" | "api";
    // Dictées
    audioDurationSec?: number;
    // Mode rapide : "ok" si le texte vient de la transcription en direct, "fallback" si la transcription normale a pris le relais
    fastMode?: "ok" | "fallback";
};

// Accès aux mémos de Dictaphone : null tant que la première lecture n'a pas eu lieu
export type VoiceStatus = { available: boolean | null; error?: string };

// Mot horodaté (en secondes), pour surligner celui en cours pendant l'écoute
export type TimedWord = { text: string; start: number; end: number };

// Bloc de parole d'un interlocuteur : "me" pour le micro, "s0", "s1"… pour les autres
export type Utterance = { speaker: string; start: number; end: number; text: string; words?: TimedWord[] };

export type MeetingStatus = "recording" | "processing" | "done" | "error";

// Réunion telle qu'enregistrée dans meetings/<id>/meeting.json
export type Meeting = {
    id: string;
    // Bundle id de l'app d'appel
    app: string;
    label: string;
    startedAt: string;
    endedAt?: string;
    durationSec?: number;
    status: MeetingStatus;
    error?: string;
    cost?: number | null;
    // Présents une fois la réunion transcrite
    speakers?: Record<string, string>;
    utterances?: Utterance[];
};

// Réunion dans la liste : sans la transcription, avec un aperçu du texte
export type MeetingSummary = Omit<Meeting, "speakers" | "utterances"> & { preview: string };

// Réunion ouverte dans la fenêtre
export type MeetingDetails = Meeting & { hasAudio: boolean };

// États de la pastille de correction et de dictée
export type OverlayState = "listening" | "loading" | "done" | "error" | "hidden";

// États de la pilule d'enregistrement des appels
export type IndicatorState = { state: "recording" | "processing" | "done" | "error" | "hidden"; startedAt?: number | null };

// Niveaux du micro et du son du Mac pendant un enregistrement, entre 0 et 1
export type AudioLevels = { mic: number; system: number };
