import { useEffect, useState } from "react";
import type { HistoryEntry } from "../../../shared/types";
import { HistoryList } from "../components/HistoryList";
import { Subtitle, fieldClass, titleClass } from "../components/ui";

export function Dictations({ history }: { history: HistoryEntry[] }) {
    // Français tant que le réglage n'est pas lu
    const [language, setLanguage] = useState("fr");

    useEffect(() => {
        window.steno.getDictationLanguage().then(setLanguage);
    }, []);

    function changeLanguage(value: string) {
        setLanguage(value);
        window.steno.setDictationLanguage(value);
    }

    return (
        <>
            <h1 className={`mb-7 ${titleClass}`}>Dictées</h1>
            <Subtitle>Maintiens Option droite, parle, puis relâche : le texte est collé là où se trouve le curseur.</Subtitle>
            <label className="mb-[18px] flex items-center gap-2.5 text-[13.5px] text-muted">
                Langue
                <select className={`${fieldClass} h-8 px-[11px]`} value={language} onChange={(e) => changeLanguage(e.target.value)}>
                    <option value="fr">Français</option>
                    <option value="en">Anglais</option>
                    <option value="auto">Auto</option>
                </select>
            </label>
            <HistoryList
                entries={history.filter((entry) => entry.source === "dictation")}
                emptyMessage="Aucune dictée pour l'instant. Maintiens Option droite et parle : le texte apparaîtra ici."
            />
        </>
    );
}
