// Lecteur des réunions : boîte à part sous le panneau, visible seulement sur une réunion ouverte qui a un audio
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { MeetingDetails } from "../../../shared/types";
import { formatMemoDuration } from "../lib/format";
import { Back15Icon, Forward15Icon, PauseIcon, PlayIcon } from "./icons";
import { IconButton } from "./ui";

const PLAYBACK_SPEEDS = [1, 1.5, 2];

export function Player({ meeting, audio, visible }: { meeting: MeetingDetails | null; audio: RefObject<HTMLAudioElement | null>; visible: boolean }) {
    const [paused, setPaused] = useState(true);
    const [rate, setRate] = useState(1);
    const [fileDuration, setFileDuration] = useState(NaN);
    const [position, setPosition] = useState(0);
    // Pendant qu'on fait glisser la barre, c'est la souris qui la place, pas la lecture
    const seeking = useRef(false);

    // Durée lue dans le fichier, ou celle de la réunion tant que le fichier ne l'a pas donnée
    const duration = Number.isFinite(fileDuration) ? fileDuration : (meeting?.durationSec ?? 0);

    // Met l'audio de la réunion affichée dans le lecteur ; sans audio, le lecteur est vidé
    useEffect(() => {
        const player = audio.current!;
        if (!meeting?.hasAudio) {
            player.removeAttribute("src");
            player.load();
            return;
        }

        let url: string | null = null;
        let cancelled = false;
        window.steno.getMeetingAudio(meeting.id).then((bytes) => {
            if (cancelled) return;
            url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "audio/ogg" }));
            player.src = url;
        });
        return () => {
            cancelled = true;
            if (url) URL.revokeObjectURL(url);
        };
    }, [audio, meeting?.id, meeting?.hasAudio]);

    // Position de lecture, suivie à chaque image pendant l'écoute : timeupdate n'arrive que 4 fois par seconde
    useEffect(() => {
        const player = audio.current!;
        let frame = 0;
        const follow = () => {
            if (!seeking.current) setPosition(player.currentTime);
            frame = requestAnimationFrame(follow);
        };
        const sync = () => {
            setPaused(player.paused);
            setRate(player.playbackRate);
            setFileDuration(player.duration);
            if (!seeking.current) setPosition(player.currentTime);
        };
        const onPlay = () => {
            sync();
            cancelAnimationFrame(frame);
            follow();
        };
        const onPause = () => {
            sync();
            cancelAnimationFrame(frame);
        };
        const stopSeeking = () => (seeking.current = false);

        const events: [string, () => void][] = [
            ["play", onPlay],
            ["pause", onPause],
            ["timeupdate", sync],
            ["durationchange", sync],
            ["ratechange", sync],
            ["emptied", sync],
        ];
        for (const [event, listener] of events) player.addEventListener(event, listener);
        document.addEventListener("pointerup", stopSeeking);
        return () => {
            cancelAnimationFrame(frame);
            for (const [event, listener] of events) player.removeEventListener(event, listener);
            document.removeEventListener("pointerup", stopSeeking);
        };
    }, [audio]);

    const player = () => audio.current!;
    const shown = Math.min(position, duration);

    // La vitesse choisie est gardée d'une réunion à l'autre
    function changeSpeed() {
        const next = PLAYBACK_SPEEDS[(PLAYBACK_SPEEDS.indexOf(player().playbackRate) + 1) % PLAYBACK_SPEEDS.length];
        player().defaultPlaybackRate = next;
        player().playbackRate = next;
    }

    return (
        <div className={`col-start-2 mr-2.5 mb-2.5 items-center gap-3 rounded-2xl border border-panel-border bg-panel px-4 py-2.5 ${visible && meeting?.hasAudio ? "flex" : "hidden"}`}>
            <audio ref={audio} preload="metadata" />
            <IconButton
                icon={Back15Icon}
                title="Reculer de 15 s"
                onClick={() => (player().currentTime = Math.max(0, player().currentTime - 15))}
                className="text-muted"
                iconClassName="size-[19px]"
            />
            <button
                type="button"
                title={paused ? "Lecture" : "Pause"}
                onClick={() => (player().paused ? player().play() : player().pause())}
                className="flex size-[34px] flex-none items-center justify-center rounded-full bg-ink text-white"
            >
                {paused ? <PlayIcon className="size-[15px]" /> : <PauseIcon className="size-[15px]" />}
            </button>
            <IconButton
                icon={Forward15Icon}
                title="Avancer de 15 s"
                onClick={() => (player().currentTime = Math.min(duration, player().currentTime + 15))}
                className="text-muted"
                iconClassName="size-[19px]"
            />
            <span className="min-w-[34px] text-center text-[12.5px] text-muted tabular-nums">{formatMemoDuration(shown)}</span>
            {/* Barre de lecture : la partie écoutée est foncée, jusqu'à --progress */}
            <input
                type="range"
                min="0"
                max={duration}
                step="any"
                value={shown}
                aria-label="Position de lecture"
                style={{ "--progress": `${duration ? (shown / duration) * 100 : 0}%` } as CSSProperties}
                onPointerDown={() => (seeking.current = true)}
                onChange={(e) => {
                    player().currentTime = Number(e.target.value);
                    setPosition(Number(e.target.value));
                }}
                className="h-1 flex-1 cursor-pointer appearance-none rounded-[2px] bg-[linear-gradient(to_right,var(--color-ink)_var(--progress,0%),#e2e0db_var(--progress,0%))] outline-none [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-ink"
            />
            <span className="min-w-[34px] text-center text-[12.5px] text-muted tabular-nums">{formatMemoDuration(duration)}</span>
            <button
                type="button"
                title="Vitesse de lecture"
                onClick={changeSpeed}
                className="h-[26px] min-w-11 rounded-[7px] border border-border bg-card px-2 text-[12.5px] text-ink tabular-nums hover:bg-hover"
            >
                {`${String(rate).replace(".", ",")}×`}
            </button>
        </div>
    );
}
