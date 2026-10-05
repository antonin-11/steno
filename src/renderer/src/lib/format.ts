// Mise en forme des dates, durées et coûts affichés dans la fenêtre principale

export function dayLabel(date: Date) {
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return "Aujourd'hui";
    if (date.toDateString() === yesterday.toDateString()) return "Hier";
    return date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

// Regroupe des éléments par jour, dans l'ordre où ils arrivent
export function groupByDay<T>(items: T[], date: (item: T) => string) {
    const groups: { label: string; items: T[] }[] = [];
    for (const item of items) {
        const label = dayLabel(new Date(date(item)));
        if (groups.at(-1)?.label !== label) groups.push({ label, items: [] });
        groups.at(-1)!.items.push(item);
    }
    return groups;
}

// Heure française sur 24 h, ex. « 08:05 », « 19:55 »
export function formatTime(date: Date) {
    return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// Ex. : « 0,0512$ », « 0,000830$ »
export function formatCost(entry: { cost?: number | null; costStatus?: string }) {
    if (entry.costStatus === "pending") return "…";
    if (typeof entry.cost !== "number") return "—";
    return (entry.cost < 0.01 ? entry.cost.toFixed(6) : entry.cost.toFixed(4)).replace(".", ",") + "$";
}

export function formatDuration(ms: number) {
    return (ms / 1000).toFixed(1) + " s";
}

// Position dans un audio, ex. « 1:23 »
export function formatMemoDuration(seconds: number) {
    const total = Math.round(seconds);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// Durée d'un mémo en toutes lettres, pour ne pas la confondre avec une heure : « 45 s », « 1 min 23 s », « 12 min »
export function formatLength(seconds: number) {
    const total = Math.round(seconds);
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    if (minutes === 0) return `${rest} s`;
    return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

// Ex. : « Mercredi 23 septembre - 8h56 »
export function formatMemoDate(date: Date) {
    const day = date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    const time = `${date.getHours()}h${String(date.getMinutes()).padStart(2, "0")}`;
    return `${day.charAt(0).toUpperCase()}${day.slice(1)} - ${time}`;
}

const compact = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });
// « 1,2 k » devient « 1,2k »
export const formatCount = (count: number) => compact.format(count).replace(/\s/g, "");

export const countWords = (text?: string) => text?.match(/\S+/g)?.length ?? 0;
export const plural = (count: number, singular: string, pluralForm: string) => (count > 1 ? pluralForm : singular);
