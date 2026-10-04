const { contextBridge, ipcRenderer } = require("electron");

// API exposée à la fenêtre principale
contextBridge.exposeInMainWorld("tenlex", {
    getHistory: () => ipcRenderer.invoke("get-history"),
    copyText: (text) => ipcRenderer.invoke("copy-text", text),
    onHistoryUpdated: (callback) => ipcRenderer.on("history-updated", (_event, history) => callback(history)),
    getDictionary: () => ipcRenderer.invoke("get-dictionary"),
    addWord: (word) => ipcRenderer.invoke("add-word", word),
    removeWord: (word) => ipcRenderer.invoke("remove-word", word),
    getVoiceStatus: () => ipcRenderer.invoke("get-voice-status"),
    onVoiceStatus: (callback) => ipcRenderer.on("voice-status", (_event, status) => callback(status)),
    getMeetings: () => ipcRenderer.invoke("get-meetings"),
    getMeeting: (id) => ipcRenderer.invoke("get-meeting", id),
    renameSpeaker: (id, speaker, name) => ipcRenderer.invoke("rename-speaker", id, speaker, name),
    deleteMeeting: (id) => ipcRenderer.invoke("delete-meeting", id),
    onMeetingsUpdated: (callback) => ipcRenderer.on("meetings-updated", (_event, meetings) => callback(meetings)),
    getDictationLanguage: () => ipcRenderer.invoke("get-dictation-language"),
    setDictationLanguage: (language) => ipcRenderer.invoke("set-dictation-language", language),
});
