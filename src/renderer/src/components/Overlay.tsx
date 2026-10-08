// Pastille flottante en bas de l'écran : correction (Cmd+O) et dictée
import { useEffect, useRef } from "react";
import { createOverlayAnimation } from "../lib/overlay-animation";

export function Overlay() {
    const root = useRef<HTMLDivElement>(null);
    const pill = useRef<HTMLDivElement>(null);
    const letters = useRef<HTMLDivElement>(null);
    const wavePath = useRef<SVGPathElement>(null);

    useEffect(() => {
        const animation = createOverlayAnimation({ root: root.current!, pill: pill.current!, letters: letters.current!, wavePath: wavePath.current! });
        const stopState = window.steno.onOverlayState(animation.setState);
        const stopLevel = window.steno.onOverlayLevel(animation.setLevel);
        return () => {
            stopState();
            stopLevel();
            animation.dispose();
        };
    }, []);

    return (
        <div ref={root} className="group flex h-full items-center justify-center">
            <div
                ref={pill}
                className="group/pill relative flex h-[34px] min-w-[34px] translate-y-2 scale-90 items-center justify-center rounded-[17px] border border-white/14 bg-[rgba(18,18,18,0.92)] px-3.5 opacity-0 transition-[opacity,translate,scale] duration-[180ms] ease-[ease] group-[.visible]:translate-y-0 group-[.visible]:scale-100 group-[.visible]:opacity-100"
            >
                {/* Lettres qui défilent pendant la correction */}
                <div ref={letters} className="flex font-mono text-[12px] text-white/85 group-[.curl]:hidden group-[.done]:hidden group-[.error]:hidden group-[.listening]:hidden" />
                {/* Vague du logo qui ondule avec la voix pendant la dictée.
                    Elle ne rétrécit pas avec la pilule, et le rond qu'elle forme en s'enroulant déborde de sa boîte. */}
                <svg
                    className="hidden h-[14px] w-8 shrink-0 overflow-visible group-[.curl]:block group-[.listening]:block group-[.loading.curl]:group-hover/pill:invisible"
                    viewBox="0 0 32 14"
                    fill="none"
                    stroke="#c96d4e"
                    strokeWidth="4.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <path ref={wavePath} />
                </svg>
                <svg className="hidden size-4 text-[#4ade80] group-[.done]:block" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 8.5l3.2 3L13 4.5" />
                </svg>
                <svg className="hidden size-4 text-[#f87171] group-[.error]:block" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
                {/* Survolé pendant la transcription d'une dictée, le rond laisse place à une croix qui l'annule */}
                <button
                    type="button"
                    title="Annuler"
                    onClick={() => window.steno.cancelOverlay()}
                    className="absolute inset-0 hidden items-center justify-center text-white/85 group-[.loading.curl]:group-hover/pill:flex"
                >
                    <svg className="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                        <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
                    </svg>
                </button>
            </div>
        </div>
    );
}
