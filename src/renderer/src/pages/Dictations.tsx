import { useEffect, useState } from "react";
import type { HistoryEntry } from "../../../shared/types";
import { HistoryList } from "../components/HistoryList";
import { InfoTip, Subtitle, Switch, fieldClass, titleClass } from "../components/ui";

export function Dictations({ history }: { history: HistoryEntry[] }) {
    // Français tant que le réglage n'est pas lu
    const [language, setLanguage] = useState("fr");
    const [fast, setFast] = useState(false);

    useEffect(() => {
        window.steno.getDictationLanguage().then(setLanguage);
        window.steno.getFastDictation().then(setFast);
    }, []);

    function changeLanguage(value: string) {
        setLanguage(value);
        window.steno.setDictationLanguage(value);
    }

    function changeFast(enabled: boolean) {
        setFast(enabled);
        window.steno.setFastDictation(enabled);
    }

    return (
        <>
            <h1 className={`mb-7 ${titleClass}`}>Dictées</h1>
            <Subtitle>Maintiens Option droite, parle, puis relâche : le texte est collé là où se trouve le curseur.</Subtitle>
            <div className="mb-[18px] flex items-center gap-8 text-[13.5px] text-muted">
                <label className="flex items-center gap-2.5">
                    Langue
                    <select className={`${fieldClass} h-8 px-[11px]`} value={language} onChange={(e) => changeLanguage(e.target.value)}>
                        <option value="fr">Français</option>
                        <option value="en">Anglais</option>
                        <option value="auto">Auto</option>
                    </select>
                </label>
                <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2.5">
                        Mode rapide
                        <Switch checked={fast} onChange={changeFast} />
                    </label>
                    <InfoTip>
                        Le texte s'affiche presque dès que tu relâches les touches : environ 0,2 s au lieu de 2 à 3 s. En contrepartie, la
                        transcription coûte environ 5 fois plus cher, et le dictionnaire comme la langue choisie ne s'appliquent pas.
                    </InfoTip>
                </div>
            </div>
            <HistoryList
                entries={history.filter((entry) => entry.source === "dictation")}
                emptyMessage="Aucune dictée pour l'instant. Maintiens Option droite et parle : le texte apparaîtra ici."
            />
        </>
    );
}
