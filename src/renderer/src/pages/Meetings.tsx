import { Fragment, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { MeetingDetails, MeetingSummary, Utterance } from "../../../shared/types";
import googleMeetLogo from "../assets/app-logos/google-meet.svg";
import slackLogo from "../assets/app-logos/slack.svg";
import teamsLogo from "../assets/app-logos/teams.svg";
import { BackIcon, TrashIcon } from "../components/icons";
import { Card, CopyButton, DayHeader, DayLabel, Empty, IconButton, Notice, Row, Subtitle, fieldClass, titleClass } from "../components/ui";
import { formatCost, formatLength, formatMemoDate, formatMemoDuration, formatTime, groupByDay } from "../lib/format";

// Logos officiels des apps d'appel (Wikimedia Commons), affichés à côté de leur nom dans la liste
const APP_LOGOS: Record<string, string> = { "Google Meet": googleMeetLogo, Slack: slackLogo, Teams: teamsLogo };

const MEETING_STATUS: Record<string, string> = { recording: "Enregistrement en cours…", processing: "Transcription en cours…" };

// Un mot reste surligné ce temps après sa fin, pour éviter un clignotement entre deux mots
const WORD_HOLD_SECONDS = 0.3;

function meetingTitle(meeting: MeetingDetails) {
    return `${meeting.label} · ${formatMemoDate(new Date(meeting.startedAt))}`;
}

// Deux interlocuteurs renommés pareil sont fusionnés : leurs blocs qui se suivent aussi
function transcriptBlocks(meeting: MeetingDetails) {
    const speakers = meeting.speakers ?? {};
    const blocks: Utterance[] = [];
    for (const utterance of meeting.utterances ?? []) {
        const last = blocks.at(-1);
        if (last && speakers[last.speaker] === speakers[utterance.speaker]) {
            last.text += ` ${utterance.text}`;
            last.words = last.words && utterance.words ? [...last.words, ...utterance.words] : undefined;
        } else {
            blocks.push({ ...utterance });
        }
    }
    return blocks;
}

function MeetingList({ meetings, onOpen }: { meetings: MeetingSummary[]; onOpen: (id: string) => void }) {
    const groups = groupByDay(meetings, (meeting) => meeting.startedAt);

    return (
        <>
            <h1 className={`mb-7 ${titleClass}`}>Réunions</h1>
            <Subtitle>Les appels Slack, Google Meet et Teams sont enregistrés automatiquement, puis transcrits.</Subtitle>
            {groups.length === 0 && (
                <Card>
                    <Empty>Aucune réunion pour l'instant. Lance un appel Slack, Google Meet ou Teams : il sera enregistré automatiquement.</Empty>
                </Card>
            )}
            {groups.map((group, index) => (
                <section key={group.label} className={index > 0 ? "mt-[26px]" : ""}>
                    <DayHeader>
                        <DayLabel>{group.label}</DayLabel>
                    </DayHeader>
                    <Card>
                        {group.items.map((meeting) => (
                            <Row key={meeting.id} onClick={() => onOpen(meeting.id)}>
                                {/* L'heure précède le nom de l'app, suivi de son logo : une colonne de texte, une colonne de durée */}
                                <div className="min-w-0 flex-1 text-[14.5px] leading-[1.55] wrap-anywhere whitespace-pre-wrap">
                                    <span className="mb-0.5 flex items-center gap-1.5 text-[12.5px] text-muted">
                                        {`${formatTime(new Date(meeting.startedAt))} · ${meeting.label}`}
                                        {APP_LOGOS[meeting.label] && <img className="h-3 w-auto" src={APP_LOGOS[meeting.label]} alt="" />}
                                    </span>
                                    {meeting.status === "error" ? (
                                        <span className="text-[#a3402a]">{`Échec : ${meeting.error}`}</span>
                                    ) : MEETING_STATUS[meeting.status] ? (
                                        <span className="text-muted">{MEETING_STATUS[meeting.status]}</span>
                                    ) : (
                                        <span className="line-clamp-2">{meeting.preview || "(aucune parole détectée)"}</span>
                                    )}
                                </div>
                                <div className="flex-none text-right text-[13px] text-muted tabular-nums">{meeting.durationSec ? formatLength(meeting.durationSec) : ""}</div>
                            </Row>
                        ))}
                    </Card>
                </section>
            ))}
        </>
    );
}

// Champ de renommage d'un interlocuteur : Entrée ou un clic à côté enregistre, Échap annule
function SpeakerEditor({ name, focus, onFinish }: { name: string; focus: boolean; onFinish: (name: string | null) => void }) {
    const [value, setValue] = useState(name);
    const input = useRef<HTMLInputElement>(null);
    const finished = useRef(false);

    useEffect(() => {
        if (focus) input.current?.select();
    }, [focus]);

    function finish(save: boolean) {
        if (finished.current) return;
        finished.current = true;
        onFinish(save ? value : null);
    }

    return (
        <input
            ref={input}
            className={`${fieldClass} h-[26px] w-full px-2`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
                if (e.key === "Enter") finish(true);
                if (e.key === "Escape") finish(false);
            }}
            onBlur={() => finish(true)}
        />
    );
}

// Transcription, avec le bloc et le mot en cours surlignés pendant l'écoute.
// Le surlignage suit l'audio image par image sans passer par React : une longue réunion compte des milliers de mots
function Transcript({ meeting, audio, onRename }: { meeting: MeetingDetails; audio: RefObject<HTMLAudioElement | null>; onRename: (speaker: string, name: string) => Promise<void> }) {
    const blocks = useMemo(() => transcriptBlocks(meeting), [meeting]);
    const speakers = meeting.speakers ?? {};
    // Interlocuteur en cours de renommage : un champ dans chacun de ses blocs, le curseur dans le dernier
    const [editing, setEditing] = useState<string | null>(null);
    const rows = useRef<(HTMLDivElement | null)[]>([]);
    const words = useRef<(HTMLSpanElement | null)[][]>([]);

    useEffect(() => {
        const player = audio.current;
        if (!player) return;

        const playbackBlocks = blocks.map((block, i) => ({ row: rows.current[i], start: block.start }));
        // Mots de chaque interlocuteur, dans l'ordre : deux personnes peuvent parler en même temps
        const playbackWords = new Map<string, { el: HTMLSpanElement | null; start: number; end: number }[]>();
        blocks.forEach((block, i) => {
            const blockWords = (block.words ?? []).map((word, j) => ({ el: words.current[i]?.[j] ?? null, start: word.start, end: word.end }));
            playbackWords.set(block.speaker, [...(playbackWords.get(block.speaker) ?? []), ...blockWords]);
        });
        let playingRow: HTMLElement | null = null;
        let playingWords = new Set<HTMLElement>();

        function highlight() {
            // Rien de surligné tant que l'écoute n'a pas commencé
            const started = player!.currentTime > 0 || !player!.paused;
            const time = started ? player!.currentTime : -1;
            const row = playbackBlocks.findLast((b) => b.start <= time)?.row ?? null;

            // Mot en cours de chaque interlocuteur, même s'il continue de parler pendant le bloc suivant
            const current = new Set<HTMLElement>();
            for (const speakerWords of playbackWords.values()) {
                const word = speakerWords.findLast((w) => w.start <= time);
                if (word?.el && time <= word.end + WORD_HOLD_SECONDS) current.add(word.el);
            }

            if (row !== playingRow) {
                if (playingRow) delete playingRow.dataset.playing;
                if (row) row.dataset.playing = "";
                playingRow = row;
            }
            for (const el of playingWords) {
                if (!current.has(el)) delete el.dataset.current;
            }
            for (const el of current) el.dataset.current = "";
            playingWords = current;
        }

        // timeupdate n'arrive que 4 fois par seconde : trop lent pour suivre les mots
        let frame = 0;
        function follow() {
            highlight();
            frame = requestAnimationFrame(follow);
        }
        function onPlay() {
            cancelAnimationFrame(frame);
            follow();
        }
        const onPause = () => cancelAnimationFrame(frame);

        player.addEventListener("play", onPlay);
        player.addEventListener("pause", onPause);
        player.addEventListener("seeked", highlight);
        if (player.paused) highlight();
        else follow();

        return () => {
            cancelAnimationFrame(frame);
            player.removeEventListener("play", onPlay);
            player.removeEventListener("pause", onPause);
            player.removeEventListener("seeked", highlight);
            if (playingRow) delete playingRow.dataset.playing;
            for (const el of playingWords) delete el.dataset.current;
        };
    }, [blocks, audio]);

    async function finishEditing(speaker: string, name: string | null) {
        if (name !== null) await onRename(speaker, name);
        setEditing(null);
    }

    if (meeting.status !== "done") return null;
    const focusedBlock = blocks.findLastIndex((block) => block.speaker === editing);

    return (
        <Card>
            {blocks.length === 0 && <Empty>Aucune parole détectée.</Empty>}
            {blocks.map((block, i) => (
                <div
                    key={i}
                    ref={(el) => {
                        rows.current[i] = el;
                    }}
                    className="flex gap-4 border-t border-row-border px-4 py-[13px] first:border-t-0 data-playing:bg-hover"
                >
                    <div className="min-w-0 flex-[0_0_140px]">
                        {editing === block.speaker ? (
                            <SpeakerEditor name={speakers[block.speaker]} focus={i === focusedBlock} onFinish={(name) => finishEditing(block.speaker, name)} />
                        ) : (
                            <button
                                type="button"
                                title="Renommer"
                                onClick={() => setEditing(block.speaker)}
                                className="max-w-full text-left text-[13.5px] font-medium text-ink wrap-anywhere hover:underline"
                            >
                                {speakers[block.speaker]}
                            </button>
                        )}
                        <span className="mt-[3px] block text-[12px] text-faint tabular-nums">{formatMemoDuration(block.start)}</span>
                    </div>
                    {/* Un mot par élément quand on a leurs horodatages (réunions transcrites avant : texte seul) */}
                    <div className="min-w-0 flex-1 text-[14.5px] leading-[1.55] wrap-anywhere whitespace-pre-wrap">
                        {block.words?.length
                            ? block.words.map((word, j) => (
                                  <Fragment key={j}>
                                      {j > 0 && " "}
                                      <span
                                          ref={(el) => {
                                              (words.current[i] ??= [])[j] = el;
                                          }}
                                          className="data-current:-mx-0.5 data-current:rounded-[3px] data-current:bg-ink/10 data-current:px-0.5"
                                      >
                                          {word.text}
                                      </span>
                                  </Fragment>
                              ))
                            : block.text}
                    </div>
                </div>
            ))}
        </Card>
    );
}

function MeetingDetail({
    meeting,
    audio,
    onBack,
    onRename,
}: {
    meeting: MeetingDetails;
    audio: RefObject<HTMLAudioElement | null>;
    onBack: () => void;
    onRename: (speaker: string, name: string) => Promise<void>;
}) {
    const meta = [meeting.durationSec && `Durée ${formatLength(meeting.durationSec)}`, typeof meeting.cost === "number" && `Coût ${formatCost(meeting)}`]
        .filter(Boolean)
        .join(" · ");

    function transcriptText() {
        const speakers = meeting.speakers ?? {};
        return transcriptBlocks(meeting)
            .map((block) => `${speakers[block.speaker]} : ${block.text}`)
            .join("\n\n");
    }

    async function remove() {
        if (!confirm("Supprimer cette réunion et son audio ?")) return;
        await window.steno.deleteMeeting(meeting.id);
    }

    return (
        <>
            <div className="-mt-1 mb-1.5 -ml-1.5 flex items-center gap-2">
                <IconButton icon={BackIcon} title="Retour" onClick={onBack} />
                <h1 className={`flex-1 ${titleClass}`}>{meetingTitle(meeting)}</h1>
                <div className="flex">
                    {meeting.status === "done" && <CopyButton title="Copier la transcription" text={transcriptText} />}
                    <IconButton icon={TrashIcon} title="Supprimer" onClick={remove} />
                </div>
            </div>
            <p className="mb-[18px] text-[13.5px] text-muted">{MEETING_STATUS[meeting.status] ?? meta}</p>
            {meeting.status === "error" && <Notice>{`Échec : ${meeting.error}`}</Notice>}
            <Transcript meeting={meeting} audio={audio} onRename={onRename} />
        </>
    );
}

// Liste des réunions, ou la réunion ouverte. La réunion ouverte est gardée par App : le lecteur, sous le panneau, en lit l'audio
export function Meetings({
    openMeeting,
    setOpenMeeting,
    audio,
}: {
    openMeeting: MeetingDetails | null;
    setOpenMeeting: (meeting: MeetingDetails | null) => void;
    audio: RefObject<HTMLAudioElement | null>;
}) {
    const [meetings, setMeetings] = useState<MeetingSummary[]>([]);

    useEffect(() => {
        window.steno.getMeetings().then(setMeetings);
        return window.steno.onMeetingsUpdated(setMeetings);
    }, []);

    async function show(id: string) {
        setOpenMeeting(await window.steno.getMeeting(id));
    }

    // La réunion affichée a été supprimée, ou son statut a changé (ex. transcription terminée)
    useEffect(() => {
        if (!openMeeting) return;
        const summary = meetings.find((meeting) => meeting.id === openMeeting.id);
        if (!summary) setOpenMeeting(null);
        else if (summary.status !== openMeeting.status) show(openMeeting.id);
        // Seule une nouvelle liste déclenche la vérification
    }, [meetings]);

    if (!openMeeting) return <MeetingList meetings={meetings} onOpen={show} />;

    return (
        <MeetingDetail
            key={openMeeting.id}
            meeting={openMeeting}
            audio={audio}
            onBack={() => setOpenMeeting(null)}
            onRename={async (speaker, name) => setOpenMeeting(await window.steno.renameSpeaker(openMeeting.id, speaker, name))}
        />
    );
}
