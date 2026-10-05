// Fenêtre principale : historique des corrections, dictées, vocaux et réunions, et dictionnaire
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { HistoryEntry, MeetingDetails } from "../../shared/types";
import { Player } from "./components/Player";
import { Sidebar, type Page } from "./components/Sidebar";
import { Splash } from "./components/Splash";
import { Corrections } from "./pages/Corrections";
import { Dictations } from "./pages/Dictations";
import { Dictionary } from "./pages/Dictionary";
import { Meetings } from "./pages/Meetings";
import { VoiceMemos } from "./pages/VoiceMemos";

const PAGES: Page[] = ["corrections", "dictations", "voice", "meetings", "dictionary"];

// Les entrées sont triées par date de création ; les mémos gardent la date d'enregistrement
const byDateDesc = (a: HistoryEntry, b: HistoryEntry) => new Date(b.date).getTime() - new Date(a.date).getTime();

function initialPage(): Page {
    try {
        const saved = localStorage.getItem("page") as Page;
        if (PAGES.includes(saved)) return saved;
    } catch {}
    return "corrections";
}

export default function App() {
    const [page, setPage] = useState(initialPage);
    const [splash, setSplash] = useState(true);
    const [history, setHistory] = useState<HistoryEntry[]>([]);
    // Réunion ouverte et son audio, partagés par la page Réunions et le lecteur sous le panneau
    const [openMeeting, setOpenMeeting] = useState<MeetingDetails | null>(null);
    const audio = useRef<HTMLAudioElement>(null);

    useEffect(() => {
        const update = (entries: HistoryEntry[]) => setHistory([...entries].sort(byDateDesc));
        window.steno.getHistory().then(update);
        return window.steno.onHistoryUpdated(update);
    }, []);

    function navigate(target: Page) {
        setPage(target);
        try {
            localStorage.setItem("page", target);
        } catch {}
    }

    const hideSplash = useCallback(() => setSplash(false), []);

    const content: Record<Page, ReactNode> = {
        corrections: <Corrections history={history} />,
        dictations: <Dictations history={history} />,
        voice: <VoiceMemos history={history} />,
        meetings: <Meetings openMeeting={openMeeting} setOpenMeeting={setOpenMeeting} audio={audio} />,
        dictionary: <Dictionary />,
    };

    // Deuxième ligne de la grille : le lecteur des réunions, sous le panneau (vide le reste du temps)
    return (
        <div className="grid h-full grid-cols-[196px_1fr] grid-rows-[minmax(0,1fr)_auto]">
            {splash && <Splash onDone={hideSplash} />}
            {/* Zone de la barre de titre (feux tricolores macOS), déplaçable */}
            <div className="fixed inset-x-0 top-0 h-9 [-webkit-app-region:drag]" />
            <Sidebar page={page} onNavigate={navigate} history={history} />
            <div className="mt-9 mr-2.5 mb-2.5 min-h-0 overflow-y-auto rounded-2xl border border-panel-border bg-panel">
                {/* Toutes les pages restent montées : la recherche, la réunion ouverte et l'écoute survivent à un changement de page */}
                {PAGES.map((name) => (
                    <section key={name} className={`px-[30px] pt-[34px] pb-[30px] ${name === page ? "block" : "hidden"}`}>
                        {content[name]}
                    </section>
                ))}
            </div>
            <Player meeting={openMeeting} audio={audio} visible={page === "meetings"} />
        </div>
    );
}
