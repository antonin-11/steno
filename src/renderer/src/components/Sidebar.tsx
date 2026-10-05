import type { ComponentType } from "react";
import type { HistoryEntry } from "../../../shared/types";
import { countWords, formatCount, plural } from "../lib/format";
import { CorrectionsIcon, DictationsIcon, DictionaryIcon, Logo, MeetingsIcon, VoiceIcon, type IconProps } from "./icons";

export type Page = "corrections" | "dictations" | "voice" | "meetings" | "dictionary";

const NAV: { page: Page; label: string; icon: ComponentType<IconProps> }[] = [
    { page: "corrections", label: "Corrections", icon: CorrectionsIcon },
    { page: "dictations", label: "Dictées", icon: DictationsIcon },
    { page: "voice", label: "Vocaux", icon: VoiceIcon },
    { page: "meetings", label: "Réunions", icon: MeetingsIcon },
    { page: "dictionary", label: "Dictionnaire", icon: DictionaryIcon },
];

// Statistiques globales : vocaux + correcteur de fautes
function Stats({ history }: { history: HistoryEntry[] }) {
    const memos = history.filter((entry) => entry.source === "voice");
    const corrections = history.filter((entry) => !entry.source);
    const transcribedWords = memos.reduce((sum, entry) => sum + countWords(entry.original), 0);
    const correctedWords = corrections.reduce((sum, entry) => sum + countWords(entry.corrected), 0);
    const cost = history.reduce((sum, entry) => sum + (typeof entry.cost === "number" ? entry.cost : 0), 0);

    const stats = [
        [formatCount(transcribedWords), plural(transcribedWords, "mot transcrit", "mots transcrits")],
        [formatCount(memos.length), plural(memos.length, "note transcrite", "notes transcrites")],
        [formatCount(correctedWords), plural(correctedWords, "mot corrigé", "mots corrigés")],
        [cost.toFixed(2).replace(".", ",") + "$", "dépensés"],
    ];

    return (
        <div
            className="mx-0.5 mt-auto flex flex-col gap-[11px] rounded-[14px] border border-border bg-panel p-4"
            title="Prix total : vocaux, correcteur de fautes et dictées, d'après les coûts du Gateway (transcriptions des vocaux et réunions non incluses)"
        >
            {stats.map(([value, label]) => (
                <div key={label} className="flex flex-wrap items-baseline gap-x-1.5">
                    <span className="font-serif text-[22px] leading-[1.1] tracking-[-0.02em] lining-nums">{value}</span>
                    <span className="text-[12.5px] text-ink">{label}</span>
                </div>
            ))}
        </div>
    );
}

export function Sidebar({ page, onNavigate, history }: { page: Page; onNavigate: (page: Page) => void; history: HistoryEntry[] }) {
    return (
        <aside className="row-span-2 flex flex-col px-2 pt-11 pb-3">
            <div className="flex items-center gap-[7px] px-2.5 pt-1 pb-[22px] text-[18px] font-[650] tracking-[-0.02em]">
                <Logo className="size-[18px]" />
                Sténo
            </div>
            {NAV.map(({ page: target, label, icon: Icon }) => (
                <button
                    key={target}
                    type="button"
                    onClick={() => onNavigate(target)}
                    className={`mb-1 flex h-[30px] w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[14.5px] text-ink ${target === page ? "bg-nav-active" : "hover:bg-nav-hover"}`}
                >
                    <Icon className="size-[18px] flex-none" />
                    {label}
                </button>
            ))}
            <Stats history={history} />
        </aside>
    );
}
