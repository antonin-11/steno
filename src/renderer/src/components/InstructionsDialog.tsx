// Instructions ajoutées au prompt de correction, modifiées dans une fenêtre modale
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { RemoveIcon } from "./icons";
import { Button, IconButton, fieldClass } from "./ui";

export function InstructionsDialog({ open, onClose }: { open: boolean; onClose: (saved?: string) => void }) {
    const dialog = useRef<HTMLDialogElement>(null);
    const input = useRef<HTMLTextAreaElement>(null);
    const [draft, setDraft] = useState("");
    // Un clic sur le fond ferme la fenêtre, mais pas une sélection de texte commencée dans le champ et relâchée à côté
    const pressedOnBackdrop = useRef(false);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        window.steno.getCorrectionInstructions().then((instructions) => {
            if (cancelled || !dialog.current) return;
            // Le texte est dans le champ avant l'ouverture, comme le curseur à sa fin
            flushSync(() => setDraft(instructions));
            dialog.current.returnValue = "";
            dialog.current.showModal();
            input.current?.focus();
        });
        return () => {
            cancelled = true;
        };
    }, [open]);

    // Seul « Enregistrer » enregistre ; Annuler, la croix, Échap et un clic à côté ferment sans rien changer
    async function handleClose() {
        if (dialog.current?.returnValue !== "save") return onClose();
        await window.steno.setCorrectionInstructions(draft);
        onClose(draft);
    }

    return (
        <dialog
            ref={dialog}
            onClose={handleClose}
            onMouseDown={(e) => (pressedOnBackdrop.current = e.target === dialog.current)}
            onClick={(e) => pressedOnBackdrop.current && e.target === dialog.current && dialog.current.close()}
            className="m-auto w-[min(520px,calc(100vw-48px))] rounded-2xl border border-border bg-panel p-0 text-ink shadow-[0_18px_50px_rgba(0,0,0,0.18)] backdrop:bg-[rgba(31,31,30,0.28)]"
        >
            <form method="dialog" className="px-5 pt-[18px] pb-5">
                <div className="-mr-1.5 mb-1 flex items-center justify-between">
                    <h2 className="text-[16px] font-[550]">Instructions de correction</h2>
                    {/* Ferme le formulaire avec la valeur « cancel », comme Annuler */}
                    <IconButton icon={RemoveIcon} title="Fermer" onClick={() => dialog.current?.close("cancel")} />
                </div>
                <p className="mb-3.5 text-[13px] leading-[1.5] text-muted">Une règle par ligne. Elles s'appliquent aussi aux mémos vocaux.</p>
                <textarea
                    ref={input}
                    className={`${fieldClass} block w-full resize-none px-[11px] py-[9px] leading-[1.5]`}
                    rows={9}
                    placeholder="Par exemple : garde les mots anglais tels quels (call, meeting, deadline)."
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                />
                <div className="mt-4 flex justify-end gap-2">
                    <Button variant="secondary" type="submit" value="cancel">
                        Annuler
                    </Button>
                    <Button type="submit" value="save">
                        Enregistrer
                    </Button>
                </div>
            </form>
        </dialog>
    );
}
