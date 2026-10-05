// Écran de lancement : le logo se transforme en « Sténo », le logo vient se placer à gauche du mot, puis l'app apparaît
import { useEffect, useEffectEvent, useState } from "react";
import { ERASED, ERASED_PATHS, INK, LOGO_LINES, LOGO_SCALE, LOGO_WAVE, MORPH_DURATION, STROKE, WORD_SIZE, cubicBezier, morphFrame } from "../lib/logo-morph";

const ease = cubicBezier(0.65, 0, 0.35, 1);
const easeOut = cubicBezier(0.2, 0, 0, 1);

// Logo et mot côte à côte, comme dans la barre latérale (écart = 7 px pour un logo de 18 px)
const logoWidth = 54 * LOGO_SCALE;
const gap = (7 / 18) * logoWidth;
const shift = (logoWidth + gap) / 2;
const logoX = -(logoWidth + gap + WORD_SIZE.width) / 2;
const logoY = (-50 * LOGO_SCALE) / 2;

// Secondes : logo seul, logo → mot, le mot se décale à droite, le logo arrive par la droite, pause, fondu
const MORPH_START = 0.3;
const SHIFT_START = MORPH_START + MORPH_DURATION + 0.05;
const SHIFT = 0.6;
// Le logo n'apparaît qu'une fois la place libérée : il ne touche jamais le S
const LOGO_START = SHIFT_START + 0.43;
const LOGO = 0.65;
const LOGO_OFFSET = 18;
const FADE_START = LOGO_START + LOGO + 0.45;
const FADE = 0.4;

const step = (time: number, start: number, duration: number) => Math.min(1, Math.max(0, (time - start) / duration));

export function Splash({ onDone }: { onDone: () => void }) {
    const [time, setTime] = useState(0);
    const finish = useEffectEvent(onDone);

    useEffect(() => {
        let start: number | null = null;
        let frame = requestAnimationFrame(function tick(now) {
            start ??= now;
            const elapsed = (now - start) / 1000;
            setTime(elapsed);
            if (elapsed < FADE_START + FADE) frame = requestAnimationFrame(tick);
            else finish();
        });
        return () => cancelAnimationFrame(frame);
    }, []);

    const morph = morphFrame(Math.min(MORPH_DURATION, Math.max(0, time - MORPH_START)), true);
    const arrival = easeOut(step(time, LOGO_START, LOGO));

    return (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-paper" style={{ opacity: 1 - ease(step(time, FADE_START, FADE)) }}>
            <svg className="w-[min(600px,70vw)]" viewBox="-220 -70 440 140" aria-hidden="true">
                <g transform={`translate(${(shift * ease(step(time, SHIFT_START, SHIFT))).toFixed(2)} 0)`}>
                    <g transform={morph.camera} fill="none" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round">
                        {ERASED.map((letter) => (
                            <path key={letter} d={ERASED_PATHS[letter]} pathLength={1} stroke={INK} style={morph.erased[letter]} />
                        ))}
                        <g transform={morph.t.transform}>
                            <path d={morph.t.bar} style={{ stroke: morph.t.stroke, opacity: morph.t.barOpacity }} />
                            <path d={morph.t.stem} style={{ stroke: morph.t.stroke }} />
                        </g>
                        <g transform={morph.accent.transform}>
                            <path d={morph.accent.d} style={{ stroke: morph.accent.stroke }} />
                        </g>
                        <g transform={morph.s.transform}>
                            <path d={morph.s.d} style={{ stroke: morph.s.stroke }} />
                        </g>
                    </g>
                </g>
                <g
                    fill="none"
                    stroke="#c96d4e"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={arrival.toFixed(3)}
                    transform={`translate(${(logoX + LOGO_OFFSET * (1 - arrival)).toFixed(2)} ${logoY.toFixed(2)}) scale(${LOGO_SCALE})`}
                >
                    <path d={LOGO_WAVE} />
                    <path d={LOGO_LINES} />
                </g>
            </svg>
        </div>
    );
}
