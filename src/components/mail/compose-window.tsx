import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { Bold, FilePlus2, Italic, List, LoaderCircle, Paperclip, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { escapeHtml, sanitizeOutgoingHtml } from "@/lib/compose-html";
import { mailApi } from "@/lib/mail-api";
import type { Account, LocalDraft } from "@/lib/types";

export interface ComposeSeed {
    to?: string;
    cc?: string;
    bcc?: string;
    attachments?: string[];
    subject?: string;
    body?: string;
    htmlBody?: string | null;
    inReplyTo?: string | null;
    references?: string | null;
}

const SEED_PREFIX = "mail-compose-seed:";

function readSeed(key: string | null): ComposeSeed {
    if (!key) return {};
    const storageKey = `${SEED_PREFIX}${key}`;
    try {
        const raw = window.localStorage.getItem(storageKey);
        window.localStorage.removeItem(storageKey);
        return raw ? (JSON.parse(raw) as ComposeSeed) : {};
    } catch {
        window.localStorage.removeItem(storageKey);
        return {};
    }
}

export function storeComposeSeed(key: string, seed?: ComposeSeed | null) {
    window.localStorage.setItem(`${SEED_PREFIX}${key}`, JSON.stringify(seed ?? {}));
}

export function clearComposeSeed(key: string) {
    window.localStorage.removeItem(`${SEED_PREFIX}${key}`);
}

export function ComposeWindow() {
    const params = new URLSearchParams(window.location.search);
    const accountId = params.get("accountId") || "";
    const seedKey = params.get("seedKey");
    const existingDraftId = params.get("draftId");
    const draftId = useRef(existingDraftId || crypto.randomUUID());
    const lastSave = useRef<Promise<void>>(Promise.resolve());

    const [account, setAccount] = useState<Account | null>(null);
    const [to, setTo] = useState("");
    const [cc, setCc] = useState("");
    const [bcc, setBcc] = useState("");
    const [subject, setSubject] = useState("");
    const [inReplyTo, setInReplyTo] = useState<string | null>(null);
    const [references, setReferences] = useState<string | null>(null);
    const [body, setBody] = useState("");
    const [htmlBody, setHtmlBody] = useState<string | null>(null);
    const editorRef = useRef<HTMLDivElement | null>(null);
    const editorInitialHtml = useRef("");
    const rich = htmlBody !== null;
    const [attachments, setAttachments] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [draftState, setDraftState] = useState<"idle" | "saving" | "saved">("idle");

    useEffect(() => {
        const seed = readSeed(seedKey);
        setTo(seed.to || "");
        setCc(seed.cc || "");
        setBcc(seed.bcc || "");
        setAttachments(seed.attachments || []);
        setSubject(seed.subject || "");
        setInReplyTo(seed.inReplyTo || null);
        setReferences(seed.references || null);
        setBody(seed.body || "");
        editorInitialHtml.current = sanitizeOutgoingHtml(seed.htmlBody || "");
        setHtmlBody(seed.htmlBody || null);

        void (async () => {
            try {
                const accounts = await mailApi.listAccounts();
                const active = accounts.find((item) => item.id === accountId) || null;
                if (!active) throw new Error("The sending account could not be found.");
                setAccount(active);
                if (existingDraftId) {
                    const drafts = await mailApi.listLocalDrafts(accountId);
                    const draft = drafts.find((item) => item.id === existingDraftId);
                    if (!draft) throw new Error("This local draft no longer exists.");
                    setTo(draft.to);
                    setCc(draft.cc);
                    setBcc(draft.bcc);
                    setSubject(draft.subject);
                    setInReplyTo(draft.inReplyTo || null);
                    setReferences(draft.references || null);
                    setBody(draft.body);
                    editorInitialHtml.current = sanitizeOutgoingHtml(draft.htmlBody || "");
                    setHtmlBody(draft.htmlBody || null);
                    setAttachments(draft.attachments);
                }
            } catch (e) {
                setError(String(e));
            } finally {
                setLoading(false);
            }
        })();
    }, [accountId, seedKey, existingDraftId]);

    useEffect(() => {
        if (loading || !rich || !editorRef.current) return;
        // The editor is uncontrolled while typing to preserve selection and
        // caret position, but re-hydrates when opening an existing draft.
        if (editorRef.current.innerHTML !== editorInitialHtml.current) editorRef.current.innerHTML = editorInitialHtml.current;
    }, [loading, rich]);

    function enableRich() {
        if (rich) return;
        const html = `<div>${escapeHtml(body).replace(/\n/g, "<br>")}</div>`;
        editorInitialHtml.current = html;
        setHtmlBody(html);
    }
    function disableRich() {
        setHtmlBody(null);
    }
    function onRichInput() {
        const editor = editorRef.current;
        if (!editor) return;
        setBody(editor.innerText);
        setHtmlBody(sanitizeOutgoingHtml(editor.innerHTML));
    }
    function formatRich(command: "bold" | "italic" | "insertUnorderedList") {
        editorRef.current?.focus();
        document.execCommand(command);
        onRichInput();
    }

    // SQLite is the source of truth for drafts. Autosave independently of the
    // mailbox window; failed sends never destroy the local draft.
    const draft = (): LocalDraft => ({
        id: draftId.current,
        accountId,
        to,
        cc,
        bcc,
        subject,
        body,
        htmlBody: htmlBody ? sanitizeOutgoingHtml(htmlBody) : null,
        attachments,
        inReplyTo,
        references,
        updatedAt: 0,
    });
    const hasContent = Boolean(to.trim() || cc.trim() || bcc.trim() || subject.trim() || body.trim() || attachments.length);
    const saveDraft = async (): Promise<boolean> => {
        if (!account || !hasContent) return true;
        setDraftState("saving");
        const job = mailApi.saveLocalDraft(draft());
        lastSave.current = job;
        try {
            await job;
            setDraftState("saved");
            await emit("mail:drafts-updated", { accountId }).catch(() => undefined);
            return true;
        } catch (cause) {
            setError(`Could not save local draft: ${String(cause)}`);
            return false;
        }
    };
    useEffect(() => {
        if (loading || !account || busy || !hasContent) return;
        setDraftState("idle");
        const snapshot: LocalDraft = {
            id: draftId.current,
            accountId,
            to,
            cc,
            bcc,
            subject,
            body,
            htmlBody: htmlBody ? sanitizeOutgoingHtml(htmlBody) : null,
            attachments,
            inReplyTo,
            references,
            updatedAt: 0,
        };
        const timer = window.setTimeout(() => {
            setDraftState("saving");
            const job = mailApi.saveLocalDraft(snapshot);
            lastSave.current = job;
            void job
                .then(async () => {
                    setDraftState("saved");
                    await emit("mail:drafts-updated", { accountId }).catch(() => undefined);
                })
                .catch((cause) => setError(`Could not save local draft: ${String(cause)}`));
        }, 900);
        return () => window.clearTimeout(timer);
    }, [loading, account, busy, hasContent, accountId, to, cc, bcc, subject, body, htmlBody, attachments, inReplyTo, references]);

    async function closeComposer() {
        await lastSave.current.catch(() => undefined);
        if (await saveDraft()) await getCurrentWindow().close();
    }

    async function chooseAttachments() {
        try {
            const selected = await openFileDialog({ multiple: true, directory: false });
            if (!selected) return;
            const paths = Array.isArray(selected) ? selected : [selected];
            setAttachments((current) => [...new Set([...current, ...paths])]);
        } catch (e) {
            setError(String(e));
        }
    }

    async function send() {
        if (!account || !to.trim()) return;
        setBusy(true);
        setError(null);
        try {
            await lastSave.current.catch(() => undefined);
            await mailApi.sendMessage({
                accountId: account.id,
                to,
                cc,
                bcc,
                subject,
                body,
                htmlBody: htmlBody ? sanitizeOutgoingHtml(htmlBody) : null,
                attachments,
                inReplyTo,
                references,
            });
            // SMTP accepted the message. Cleanup and events are best-effort,
            // and must not surface as a send error that prompts another send.
            await mailApi.deleteLocalDraft(account.id, draftId.current).catch(() => undefined);
            await emit("mail:drafts-updated", { accountId: account.id }).catch(() => undefined);
            await emit("mail:sent", { accountId: account.id }).catch(() => undefined);
            await getCurrentWindow()
                .close()
                .catch(() => undefined);
        } catch (e) {
            setError(String(e));
            setBusy(false);
        }
    }

    if (loading) {
        return (
            <main className="mail-shell flex h-full items-center justify-center">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <LoaderCircle className="size-4 animate-spin" /> Opening composer…
                </div>
            </main>
        );
    }

    return (
        <main className="mail-shell flex h-full min-h-0 flex-col bg-background">
            <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
                <div className="min-w-0">
                    <h1 className="text-sm font-semibold">New message</h1>
                    <p className="truncate text-[11px] text-muted-foreground">
                        {account ? `Sending as ${account.displayName} <${account.email}>` : "No sending account"}
                    </p>
                </div>
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => void closeComposer()}
                    disabled={busy}
                    title="Close composer"
                >
                    <X />
                </Button>
            </header>

            <div className="grid shrink-0 grid-cols-[72px_1fr] items-center border-b border-border px-5 py-2">
                <span className="text-xs text-muted-foreground">To</span>
                <Input
                    autoFocus
                    className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    placeholder="name@example.com"
                />
            </div>
            <div className="grid shrink-0 grid-cols-[72px_1fr] items-center border-b border-border px-5 py-2">
                <span className="text-xs text-muted-foreground">Cc / Bcc</span>
                <div className="grid grid-cols-2 gap-3">
                    <Input
                        className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                        value={cc}
                        onChange={(e) => setCc(e.target.value)}
                        placeholder="Cc"
                    />
                    <Input
                        className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                        value={bcc}
                        onChange={(e) => setBcc(e.target.value)}
                        placeholder="Bcc"
                    />
                </div>
            </div>
            <div className="grid shrink-0 grid-cols-[72px_1fr] items-center border-b border-border px-5 py-2">
                <span className="text-xs text-muted-foreground">Subject</span>
                <Input
                    className="border-0 bg-transparent px-0 font-medium shadow-none focus-visible:ring-0"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Subject"
                />
            </div>

            <fieldset
                className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-2"
                aria-label="Message formatting"
                disabled={busy}
            >
                <button
                    type="button"
                    aria-pressed={!rich}
                    onClick={disableRich}
                    className={`cursor-pointer rounded px-2 py-1 text-xs ${!rich ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}
                >
                    Plain text
                </button>
                <button
                    type="button"
                    aria-pressed={rich}
                    onClick={enableRich}
                    className={`cursor-pointer rounded px-2 py-1 text-xs ${rich ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}
                >
                    Rich text
                </button>
                {rich && (
                    <div className="ml-auto flex gap-1">
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            title="Bold"
                            onClick={() => formatRich("bold")}
                        >
                            <Bold className="size-4" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            title="Italic"
                            onClick={() => formatRich("italic")}
                        >
                            <Italic className="size-4" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            title="List"
                            onClick={() => formatRich("insertUnorderedList")}
                        >
                            <List className="size-4" />
                        </Button>
                    </div>
                )}
            </fieldset>
            {rich ? (
                // biome-ignore lint/a11y/useSemanticElements: A textarea cannot retain the supported rich-text markup.
                <div
                    ref={editorRef}
                    contentEditable={!busy}
                    tabIndex={0}
                    suppressContentEditableWarning
                    role="textbox"
                    aria-label="Rich text message body"
                    aria-multiline="true"
                    className="min-h-0 flex-1 overflow-y-auto p-5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onInput={onRichInput}
                    onPaste={(event) => {
                        // Prevent pasted foreign HTML/tracking pixels/scripts.
                        event.preventDefault();
                        document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
                    }}
                    onDrop={(event) => {
                        // Native HTML drops can otherwise insert live unsanitized DOM.
                        event.preventDefault();
                        if (!busy) document.execCommand("insertText", false, event.dataTransfer.getData("text/plain"));
                    }}
                />
            ) : (
                <Textarea
                    className="min-h-0 flex-1 resize-none rounded-none border-0 p-5 shadow-none focus-visible:ring-0"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Write your message…"
                />
            )}

            {attachments.length > 0 && (
                <div className="flex shrink-0 flex-wrap gap-2 border-t border-border px-5 py-3">
                    {attachments.map((path) => (
                        <div
                            key={path}
                            className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs"
                        >
                            <FilePlus2 className="size-3.5" />
                            <span className="max-w-56 truncate">{path.split(/[\\/]/).pop()}</span>
                            <button
                                type="button"
                                onClick={() => setAttachments((items) => items.filter((item) => item !== path))}
                                aria-label="Remove attachment"
                            >
                                <X className="size-3.5 text-muted-foreground" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {error && (
                <div className="mx-5 mb-3 shrink-0 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
            )}

            <footer className="flex shrink-0 items-center justify-between border-t border-border bg-muted/20 px-5 py-3">
                <span
                    aria-live="polite"
                    className="text-[11px] text-muted-foreground"
                >
                    {draftState === "saved" ? "Saved locally" : draftState === "saving" ? "Saving draft…" : "Drafts are saved locally"}
                </span>
                <Button
                    variant="ghost"
                    onClick={() => void chooseAttachments()}
                    disabled={busy}
                >
                    <Paperclip /> Attach
                </Button>
                <Button
                    onClick={() => void send()}
                    disabled={busy || !account || !to.trim()}
                >
                    {busy ? <LoaderCircle className="animate-spin" /> : <Send />} Send
                </Button>
            </footer>
        </main>
    );
}
