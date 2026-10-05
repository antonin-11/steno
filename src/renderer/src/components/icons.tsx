// Icônes de la fenêtre principale ; celles du lecteur des réunions sont d'après les icônes Tabler
import { LOGO_LINES, LOGO_WAVE } from "../lib/logo-morph";

export type IconProps = { className?: string };

// Logo de Sténo (brand/logo/steno-logo.svg) : l'onde au-dessus de deux lignes
export function Logo({ className }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 54 50" fill="none" stroke="#c96d4e" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round">
            <path d={LOGO_WAVE} />
            <path d={LOGO_LINES} />
        </svg>
    );
}

// ---------- Barre latérale ----------

export function CorrectionsIcon({ className }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6h11M4 11h8M4 16h6" />
            <path d="M13.5 17.5l2.5 2.5 5-5.5" />
        </svg>
    );
}

export function DictationsIcon({ className }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" />
        </svg>
    );
}

export function VoiceIcon({ className }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
        </svg>
    );
}

export function MeetingsIcon({ className }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 10l4.553-2.276A1 1 0 0 1 21 8.618v6.764a1 1 0 0 1-1.447.894L15 14v-4" />
            <path d="M3 8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
    );
}

export function DictionaryIcon({ className }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z" />
            <path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3" />
            <path d="M9.5 13.5l2.5-6 2.5 6M10.3 11.6h3.4" />
        </svg>
    );
}

// ---------- Actions ----------

export function InstructionsIcon({ className }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
            <circle cx="16" cy="7" r="2" />
            <circle cx="10" cy="17" r="2" />
        </svg>
    );
}

export function SearchIcon({ className }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="M15.5 15.5L21 21" />
        </svg>
    );
}

export function CopyIcon({ className }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
            <rect x="8" y="8" width="12" height="12" rx="2.5" />
            <path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8" />
        </svg>
    );
}

export function CheckIcon({ className }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
    );
}

export function RemoveIcon({ className }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
        </svg>
    );
}

export function BackIcon({ className }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
        </svg>
    );
}

export function TrashIcon({ className }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
        </svg>
    );
}

// ---------- Lecteur des réunions ----------

export function PlayIcon({ className }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 4v16a1 1 0 0 0 1.524.852l13-8a1 1 0 0 0 0-1.704l-13-8A1 1 0 0 0 6 4z" />
        </svg>
    );
}

export function PauseIcon({ className }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor">
            <path d="M9 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM17 4h-2a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
        </svg>
    );
}

export function Back15Icon({ className }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 20h2a1 1 0 0 0 1-1v-1a1 1 0 0 0-1-1H8v-3h3M15 18a6 6 0 1 0 0-12H4M5 14v6M7 9 4 6l3-3" />
        </svg>
    );
}

export function Forward15Icon({ className }: IconProps) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="m17 9 3-3-3-3M9 18A6 6 0 1 1 9 6h11M16 20h2a1 1 0 0 0 1-1v-1a1 1 0 0 0-1-1h-2v-3h3M13 14v6" />
        </svg>
    );
}
