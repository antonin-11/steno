import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
    AudioLevels,
    HistoryEntry,
    IndicatorState,
    MeetingDetails,
    MeetingSummary,
    OverlayState,
    VoiceStatus,
} from "../shared/types";

// Écoute un message du processus principal ; renvoie la fonction qui arrête l'écoute
function subscribe<T>(channel: string, callback: (value: T) => void) {
    const listener = (_event: IpcRendererEvent, value: T) => callback(value);
    ipcRenderer.on(channel, listener);
    return () => {
        ipcRenderer.removeListener(channel, listener);
    };
}

// API exposée aux fenêtres de Sténo
const steno = {
    // ---------- Fenêtre principale ----------
    getHistory: (): Promise<HistoryEntry[]> => ipcRenderer.invoke("get-history"),
    copyText: (text: string): Promise<void> => ipcRenderer.invoke("copy-text", text),
    onHistoryUpdated: (callback: (history: HistoryEntry[]) => void) => subscribe("history-updated", callback),
    getDictionary: (): Promise<string[]> => ipcRenderer.invoke("get-dictionary"),
    addWord: (word: string): Promise<string[]> => ipcRenderer.invoke("add-word", word),
    removeWord: (word: string): Promise<string[]> => ipcRenderer.invoke("remove-word", word),
    getVoiceStatus: (): Promise<VoiceStatus> => ipcRenderer.invoke("get-voice-status"),
    onVoiceStatus: (callback: (status: VoiceStatus) => void) => subscribe("voice-status", callback),
    getMeetings: (): Promise<MeetingSummary[]> => ipcRenderer.invoke("get-meetings"),
    getMeeting: (id: string): Promise<MeetingDetails> => ipcRenderer.invoke("get-meeting", id),
    getMeetingAudio: (id: string): Promise<Uint8Array> => ipcRenderer.invoke("get-meeting-audio", id),
    renameSpeaker: (id: string, speaker: string, name: string): Promise<MeetingDetails> => ipcRenderer.invoke("rename-speaker", id, speaker, name),
    deleteMeeting: (id: string): Promise<void> => ipcRenderer.invoke("delete-meeting", id),
    onMeetingsUpdated: (callback: (meetings: MeetingSummary[]) => void) => subscribe("meetings-updated", callback),
    getDictationLanguage: (): Promise<string> => ipcRenderer.invoke("get-dictation-language"),
    setDictationLanguage: (language: string): Promise<void> => ipcRenderer.invoke("set-dictation-language", language),
    getFastDictation: (): Promise<boolean> => ipcRenderer.invoke("get-fast-dictation"),
    setFastDictation: (enabled: boolean): Promise<void> => ipcRenderer.invoke("set-fast-dictation", enabled),
    getCorrectionInstructions: (): Promise<string> => ipcRenderer.invoke("get-correction-instructions"),
    setCorrectionInstructions: (instructions: string): Promise<void> => ipcRenderer.invoke("set-correction-instructions", instructions),

    // ---------- Pastille de correction et de dictée ----------
    onOverlayState: (callback: (state: OverlayState) => void) => subscribe("overlay-state", callback),
    // Niveau de la voix pendant la dictée, entre 0 et 1
    onOverlayLevel: (callback: (level: number) => void) => subscribe("overlay-level", callback),
    // Croix affichée au survol du rond de chargement de la dictée
    cancelOverlay: () => ipcRenderer.send("overlay-cancel"),

    // ---------- Pilule d'enregistrement des appels ----------
    onIndicatorState: (callback: (state: IndicatorState) => void) => subscribe("indicator-state", callback),
    onIndicatorLevels: (callback: (levels: AudioLevels) => void) => subscribe("indicator-levels", callback),
    stopRecording: () => ipcRenderer.send("indicator-stop"),
    openIndicatorMenu: () => ipcRenderer.send("indicator-menu"),
};

export type StenoApi = typeof steno;

contextBridge.exposeInMainWorld("steno", steno);
