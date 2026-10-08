// Liste groupée par jour avec recherche ; utilisée par Corrections, Dictées et Vocaux
import { useState } from "react";
import type { HistoryEntry } from "../../../shared/types";
import { formatDuration, formatLength, formatMemoDate, formatTime, groupByDay } from "../lib/format";
import { SearchIcon } from "./icons";
import { Card, CopyButton, DayHeader, DayLabel, Empty, IconButton, Row, RowActions, fieldClass } from "./ui";

// Dictaphone met une date ISO comme titre par défaut : on l'affiche en date lisible
function memoTitle(entry: HistoryEntry) {
    const isDefaultTitle = !entry.memoTitle || /^\d{4}-\d{2}-\d{2}T/.test(entry.memoTitle);
    return isDefaultTitle ? formatMemoDate(new Date(entry.date)) : entry.memoTitle;
}

// Dictée faite en mode rapide, ou repassée en transcription normale après un échec du mode rapide
function FastModeBadge({ mode }: { mode: "ok" | "fallback" }) {
    return mode === "ok" ? (
        <span title="Transcrite en mode rapide" className="flex-none rounded-full bg-terracotta/10 px-2 py-px text-[11.5px] font-medium text-terracotta">
            Rapide
        </span>
    ) : (
        <span title="Le mode rapide a échoué : transcription normale" className="flex-none rounded-full bg-black/5 px-2 py-px text-[11.5px] font-medium text-muted">
            Repli
        </span>
    );
}

function HistoryRow({ entry }: { entry: HistoryEntry }) {
    const isVoice = entry.source === "voice";
    return (
        <Row>
            {/* Pas de colonne d'heure pour les vocaux : la date est dans le titre du mémo */}
            {!isVoice && <div className="flex-[0_0_40px] text-[13px] text-muted tabular-nums">{formatTime(new Date(entry.date))}</div>}
            <div className="min-w-0 flex-1 text-[14.5px] leading-[1.55] wrap-anywhere whitespace-pre-wrap">
                {isVoice && <span className="mb-0.5 block text-[12.5px] text-muted">{`${memoTitle(entry)} · ${formatLength(entry.memoDuration ?? 0)}`}</span>}
                {entry.corrected || "(aucune parole détectée)"}
            </div>
            {entry.fastMode && <FastModeBadge mode={entry.fastMode} />}
            {/* Le coût reste enregistré mais n'est plus affiché. Pour un vocal, le temps de traitement
                n'apporte rien non plus : sa durée est déjà dans le titre */}
            {!isVoice && <div className="w-11 flex-none text-right text-[13px] text-muted tabular-nums">{formatDuration(entry.durationMs ?? 0)}</div>}
            <RowActions>
                <CopyButton title="Copier" text={() => entry.corrected} />
            </RowActions>
        </Row>
    );
}

export function HistoryList({ entries, emptyMessage, copyDay = false }: { entries: HistoryEntry[]; emptyMessage: string; copyDay?: boolean }) {
    const [query, setQuery] = useState("");
    const [searchOpen, setSearchOpen] = useState(false);

    const needle = query.trim().toLowerCase();
    const groups = groupByDay(
        entries.filter((entry) => !needle || entry.corrected.toLowerCase().includes(needle) || entry.original.toLowerCase().includes(needle)),
        (entry) => entry.date
    );

    function closeSearch() {
        setQuery("");
        setSearchOpen(false);
    }

    const search = (
        <div className="flex items-center gap-2">
            {searchOpen && (
                <input
                    className={`${fieldClass} h-8 w-[220px] px-[11px]`}
                    placeholder="Rechercher"
                    value={query}
                    autoFocus
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Escape" && closeSearch()}
                />
            )}
            <IconButton icon={SearchIcon} title="Rechercher" onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))} className="text-faint" />
        </div>
    );

    if (groups.length === 0) {
        return (
            <>
                <DayHeader>
                    <DayLabel>Aujourd'hui</DayLabel>
                    {search}
                </DayHeader>
                <Card>
                    <Empty>{needle ? "Aucun résultat." : emptyMessage}</Empty>
                </Card>
            </>
        );
    }

    return groups.map((group, index) => (
        <section key={group.label} className={index > 0 ? "mt-[26px]" : ""}>
            <DayHeader>
                <div className="flex items-center gap-1">
                    <DayLabel>{group.label}</DayLabel>
                    {copyDay && (
                        // Tout le jour d'un coup, du plus ancien au plus récent, séparé par des lignes vides
                        <CopyButton
                            title="Copier tout le jour"
                            text={() => [...group.items].reverse().map((entry) => entry.corrected).filter(Boolean).join("\n\n")}
                            className="invisible text-ink group-hover:visible"
                        />
                    )}
                </div>
                {index === 0 && search}
            </DayHeader>
            <Card>
                {group.items.map((entry) => (
                    <HistoryRow key={entry.id} entry={entry} />
                ))}
            </Card>
        </section>
    ));
}
