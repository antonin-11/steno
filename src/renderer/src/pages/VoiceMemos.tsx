import { useEffect, useState } from "react";
import type { HistoryEntry, VoiceStatus } from "../../../shared/types";
import { HistoryList } from "../components/HistoryList";
import { Notice, Subtitle, titleClass } from "../components/ui";

export function VoiceMemos({ history }: { history: HistoryEntry[] }) {
    const [status, setStatus] = useState<VoiceStatus>({ available: null });

    useEffect(() => {
        window.steno.getVoiceStatus().then(setStatus);
        return window.steno.onVoiceStatus(setStatus);
    }, []);

    return (
        <>
            <h1 className={`mb-7 ${titleClass}`}>Vocaux</h1>
            <Subtitle>Les nouveaux mémos de l'app Dictaphone sont récupérés automatiquement, transcrits puis corrigés.</Subtitle>
            {/* Bandeau affiché quand l'app n'a pas accès aux mémos */}
            {status.available === false && (
                <Notice>
                    {status.error === "permission"
                        ? "Sténo n'a pas accès aux mémos de Dictaphone. Donne l'Accès complet au disque à Sténo (en mode dev : au terminal qui le lance), dans Réglages Système › Confidentialité et sécurité, puis relance-le."
                        : `Impossible de lire les mémos de Dictaphone : ${status.error}`}
                </Notice>
            )}
            <HistoryList
                entries={history.filter((entry) => entry.source === "voice")}
                emptyMessage="Aucun mémo pour l'instant. Enregistre un mémo dans Dictaphone : il apparaîtra ici."
                copyDay
            />
        </>
    );
}
