import { useEffect, useState } from "react";
import type { HistoryEntry } from "../../../shared/types";
import { HistoryList } from "../components/HistoryList";
import { InstructionsIcon } from "../components/icons";
import { InstructionsDialog } from "../components/InstructionsDialog";
import { Button, titleClass } from "../components/ui";

// Nombre de règles actives, masqué quand il n'y en a pas
const countRules = (instructions: string) => instructions.split("\n").filter((line) => line.trim()).length;

export function Corrections({ history }: { history: HistoryEntry[] }) {
    const [rules, setRules] = useState(0);
    const [editing, setEditing] = useState(false);

    useEffect(() => {
        window.steno.getCorrectionInstructions().then((instructions) => setRules(countRules(instructions)));
    }, []);

    return (
        <>
            <div className="mb-7 flex items-center justify-between">
                <h1 className={titleClass}>Corrections</h1>
                <Button variant="secondary" onClick={() => setEditing(true)}>
                    <InstructionsIcon className="size-4 text-muted" />
                    Instructions
                    {rules > 0 && (
                        <span className="h-[18px] min-w-[18px] rounded-[9px] bg-nav-active px-[5px] text-center text-[11.5px] leading-[18px] text-muted tabular-nums">{rules}</span>
                    )}
                </Button>
            </div>
            {/* Les corrections n'ont pas de champ source ; les mémos et les dictées si */}
            <HistoryList entries={history.filter((entry) => !entry.source)} emptyMessage="Aucune correction pour l'instant." />
            <InstructionsDialog
                open={editing}
                onClose={(saved) => {
                    setEditing(false);
                    if (saved !== undefined) setRules(countRules(saved));
                }}
            />
        </>
    );
}
