import { useEffect, useRef, useState, type FormEvent } from "react";
import { RemoveIcon } from "../components/icons";
import { Button, Card, Empty, IconButton, Row, RowActions, Subtitle, fieldClass, titleClass } from "../components/ui";

export function Dictionary() {
    const [words, setWords] = useState<string[]>([]);
    const [word, setWord] = useState("");
    const input = useRef<HTMLInputElement>(null);

    useEffect(() => {
        window.steno.getDictionary().then(setWords);
    }, []);

    async function add(e: FormEvent) {
        e.preventDefault();
        if (!word.trim()) return;

        setWords(await window.steno.addWord(word));
        setWord("");
        input.current?.focus();
    }

    return (
        <>
            <h1 className={`mb-7 ${titleClass}`}>Dictionnaire</h1>
            <Subtitle>Les mots ajoutés ici sont considérés comme bien orthographiés : l'IA ne les corrigera jamais.</Subtitle>
            <form className="mb-[18px] flex gap-2" onSubmit={add}>
                <input
                    ref={input}
                    className={`${fieldClass} h-8 max-w-[360px] flex-1 px-[11px]`}
                    placeholder="Ajouter un mot, un nom propre, une expression…"
                    autoComplete="off"
                    value={word}
                    onChange={(e) => setWord(e.target.value)}
                />
                <Button type="submit" disabled={!word.trim()}>
                    Ajouter
                </Button>
            </form>
            <Card>
                {words.length === 0 && <Empty>Aucun mot pour l'instant.</Empty>}
                {words.map((w) => (
                    <Row key={w} compact>
                        <div className="min-w-0 flex-1 text-[14.5px] leading-[1.55] wrap-anywhere whitespace-pre-wrap">{w}</div>
                        <RowActions>
                            <IconButton icon={RemoveIcon} title="Supprimer" onClick={async () => setWords(await window.steno.removeWord(w))} />
                        </RowActions>
                    </Row>
                ))}
            </Card>
        </>
    );
}
