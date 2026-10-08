// Éléments communs de la fenêtre principale
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { CheckIcon, CopyIcon, type IconProps } from "./icons";

export const titleClass = "text-[20px] font-[550] tracking-[-0.01em]";

// Champ de saisie ; la taille (hauteur, marges) est ajoutée selon l'endroit
export const fieldClass = "rounded-lg border border-border bg-card text-[13.5px] text-ink outline-none focus:border-[#c9c7c1]";

// Interrupteur marche/arrêt, placé dans le <label> de son réglage
export function Switch({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className={`relative h-[18px] w-[30px] flex-none rounded-full transition-colors duration-150 ${checked ? "bg-terracotta" : "bg-[#d9d7d2]"}`}
        >
            <span
                className={`absolute top-0.5 left-0.5 size-[14px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-transform duration-150 ${checked ? "translate-x-3" : ""}`}
            />
        </button>
    );
}

// Petit « i » qui affiche une explication au survol
export function InfoTip({ children }: { children: ReactNode }) {
    return (
        <span className="group/info relative flex">
            <span className="flex size-4 cursor-default items-center justify-center rounded-full border border-faint text-[10px] font-semibold text-faint">i</span>
            <span className="invisible absolute top-6 left-1/2 z-10 w-[290px] -translate-x-1/2 rounded-lg bg-ink px-3 py-2.5 text-[12.5px] leading-[1.45] text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/info:visible group-hover/info:opacity-100">
                {children}
            </span>
        </span>
    );
}

export function Subtitle({ children }: { children: ReactNode }) {
    return <p className="-mt-[18px] mb-6 text-[13.5px] leading-[1.5] text-muted">{children}</p>;
}

export function Notice({ children }: { children: ReactNode }) {
    return <div className="mb-[18px] rounded-[10px] border border-[#ecd9b0] bg-[#fbf5e7] px-3.5 py-3 text-[13.5px] leading-[1.5] text-[#6b5320]">{children}</div>;
}

export function Card({ children }: { children: ReactNode }) {
    return <div className="overflow-hidden rounded-2xl border border-border bg-card">{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
    return <div className="px-4 py-10 text-center text-[14px] text-muted">{children}</div>;
}

// Ligne d'une carte ; ses boutons d'action n'apparaissent qu'au survol (classe group)
export function Row({ compact = false, onClick, children }: { compact?: boolean; onClick?: () => void; children: ReactNode }) {
    const size = compact ? "min-h-[46px] py-2" : "min-h-[53px] py-[13px]";
    return (
        <div onClick={onClick} className={`group flex items-center gap-4 border-t border-row-border px-4 first:border-t-0 hover:bg-hover ${size} ${onClick ? "cursor-pointer" : ""}`}>
            {children}
        </div>
    );
}

// Boutons visibles seulement au survol de la ligne
export function RowActions({ children }: { children: ReactNode }) {
    return <div className="invisible flex flex-none group-hover:visible">{children}</div>;
}

export function DayHeader({ children }: { children: ReactNode }) {
    return <div className="group mb-2.5 flex h-7 items-center justify-between pl-px">{children}</div>;
}

export function DayLabel({ children }: { children: ReactNode }) {
    return <div className="text-[12px] font-medium tracking-[0.1em] text-muted uppercase">{children}</div>;
}

// Bouton carré avec une icône ; sa couleur (text-…) et ses autres classes passent par className
export function IconButton({
    icon: Icon,
    title,
    onClick,
    className = "text-ink",
    iconClassName = "size-[17px]",
}: {
    icon: ComponentType<IconProps>;
    title: string;
    onClick: () => void;
    className?: string;
    iconClassName?: string;
}) {
    return (
        <button type="button" title={title} onClick={onClick} className={`flex size-7 items-center justify-center rounded-[7px] hover:bg-black/5 ${className}`}>
            <Icon className={iconClassName} />
        </button>
    );
}

// Copie un texte et montre une coche un instant
export function CopyButton({ title, text, className }: { title: string; text: () => string; className?: string }) {
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!copied) return;
        const timer = setTimeout(() => setCopied(false), 1200);
        return () => clearTimeout(timer);
    }, [copied]);

    async function copy() {
        await window.steno.copyText(text());
        setCopied(true);
    }

    return <IconButton icon={copied ? CheckIcon : CopyIcon} title={title} onClick={copy} className={className} />;
}

export function Button({
    variant = "primary",
    type = "button",
    value,
    disabled,
    onClick,
    children,
}: {
    variant?: "primary" | "secondary";
    type?: "button" | "submit";
    value?: string;
    disabled?: boolean;
    onClick?: () => void;
    children: ReactNode;
}) {
    const style =
        variant === "primary"
            ? "bg-ink px-3.5 text-white disabled:cursor-default disabled:opacity-35"
            : "inline-flex items-center gap-[7px] border border-border bg-card px-3 text-ink hover:bg-hover";
    return (
        <button type={type} value={value} disabled={disabled} onClick={onClick} className={`h-8 rounded-lg text-[13.5px] font-medium ${style}`}>
            {children}
        </button>
    );
}
