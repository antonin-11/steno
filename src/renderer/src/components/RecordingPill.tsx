// Pilule affichée pendant l'enregistrement d'un appel, puis pendant sa transcription
import { useEffect, useState } from "react";
import type { AudioLevels, IndicatorState } from "../../../shared/types";

// Les barres de gauche suivent le micro, celles de droite le son des autres
const BAR_SOURCES = ["mic", "mic", "system", "system"] as const;
const BAR_SCALES = [0.7, 1, 1, 0.7];

function formatElapsed(ms: number) {
    const total = Math.floor(ms / 1000);
    const minutes = Math.floor(total / 60);
    const seconds = String(total % 60).padStart(2, "0");
    return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

// Niveaux du son pendant l'enregistrement ; pendant la transcription, les barres ondulent toutes seules
function Bars({ levels, processing = false }: { levels?: AudioLevels | null; processing?: boolean }) {
    return (
        <span className="flex h-[14px] items-center gap-0.5">
            {BAR_SOURCES.map((source, i) => (
                <i
                    key={i}
                    className={`h-[14px] w-0.5 rounded-[1px] bg-white/90 [transform:scaleY(0.15)] [transition:transform_0.1s_linear] ${processing ? "animate-level-wave" : ""}`}
                    style={{
                        ...(levels && { transform: `scaleY(${Math.max(0.15, levels[source] * BAR_SCALES[i])})` }),
                        ...(processing && { animationDelay: `${i * 0.15}s` }),
                    }}
                />
            ))}
        </span>
    );
}

function ResultIcon({ ok }: { ok: boolean }) {
    return ok ? (
        <svg className="size-[15px] text-[#4ade80]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8.5l3.2 3L13 4.5" />
        </svg>
    ) : (
        <svg className="size-[15px] text-[#f87171]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
    );
}

export function RecordingPill() {
    const [{ state, startedAt }, setIndicator] = useState<{ state: IndicatorState["state"]; startedAt: number | null }>({ state: "hidden", startedAt: null });
    const [levels, setLevels] = useState<AudioLevels | null>(null);
    const [now, setNow] = useState(Date.now());

    useEffect(() => {
        const stopState = window.steno.onIndicatorState((update) => {
            setIndicator((previous) => ({ state: update.state, startedAt: update.startedAt ?? previous.startedAt }));
            setLevels(null);
            setNow(Date.now());
        });
        const stopLevels = window.steno.onIndicatorLevels(setLevels);
        return () => {
            stopState();
            stopLevels();
        };
    }, []);

    // Minuteur de l'enregistrement
    useEffect(() => {
        if (state !== "recording") return;
        const timer = setInterval(() => setNow(Date.now()), 250);
        return () => clearInterval(timer);
    }, [state]);

    const visible = state !== "hidden";

    return (
        <div className="flex h-full items-center justify-center">
            <div
                onContextMenu={(e) => {
                    e.preventDefault();
                    if (state === "recording") window.steno.openIndicatorMenu();
                }}
                className={`flex h-[34px] items-center gap-[9px] rounded-[17px] border border-white/14 bg-[rgba(18,18,18,0.92)] pl-3.5 text-[12px] text-white/90 transition-[opacity,translate,scale] duration-[180ms] ease-[ease] ${visible ? "opacity-100" : "translate-y-2 scale-90 opacity-0"} ${state === "recording" ? "pr-2" : "pr-3.5"}`}
            >
                {state === "recording" && (
                    <>
                        <span className="size-2 animate-recording-dot rounded-full bg-[#ef4444]" />
                        <span className="font-mono tabular-nums">{startedAt ? formatElapsed(now - startedAt) : "0:00"}</span>
                        <Bars levels={levels} />
                        <button
                            type="button"
                            title="Arrêter l'enregistrement"
                            onClick={() => window.steno.stopRecording()}
                            className="flex size-5 items-center justify-center rounded-full bg-white/14 after:size-[7px] after:rounded-[1.5px] after:bg-white/90 hover:bg-white/26"
                        />
                    </>
                )}
                {state === "processing" && (
                    <>
                        <Bars processing />
                        <span>Transcription…</span>
                    </>
                )}
                {state === "done" && (
                    <>
                        <ResultIcon ok />
                        <span>Transcription prête</span>
                    </>
                )}
                {state === "error" && (
                    <>
                        <ResultIcon ok={false} />
                        <span>Échec, voir Réunions</span>
                    </>
                )}
            </div>
        </div>
    );
}
