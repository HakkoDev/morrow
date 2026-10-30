import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { Bold, CloudUpload, FilePlus2, ImagePlus, Italic, List, ListOrdered, LoaderCircle, Paperclip, Send, Underline, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
    const editorToken = useRef(crypto.randomUUID());
    const hasSavedLocal = useRef(Boolean(existingDraftId));
    const lastSave = useRef<Promise<void>>(Promise.resolve());
    const hasSyncedRemote = useRef(false);
    const contentVersion = useRef("");
    const serverSyncInFlight = useRef(false);
    const busyRef = useRef(false);

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
    const inlineImageInput = useRef<HTMLInputElement | null>(null);
    const editorInitialHtml = useRef("");
    const rich = htmlBody !== null;
    const [attachments, setAttachments] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [draftState, setDraftState] = useState<"idle" | "saving" | "saved">("idle");
    const [serverDraftState, setServerDraftState] = useState<"idle" | "syncing" | "synced">("idle");

    // Prevent background reconciliation from pulling a newer server version
    // over a draft currently being edited in this native compose window.
    useEffect(() => {
        if (!accountId) return;
        const id = draftId.current;
        const token = editorToken.current;
        const renew = () => {
            void mailApi.setDraftEditorActive(accountId, id, token, true).catch(() => undefined);
        };
        renew();
        // Renew while the webview exists; Rust expires orphaned leases after
        // two minutes if a composer crashes without running this cleanup.
        const heartbeat = window.setInterval(renew, 30_000);
        return () => {
            window.clearInterval(heartbeat);
            void mailApi.setDraftEditorActive(accountId, id, token, false).catch(() => undefined);
        };
    }, [accountId]);

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
                    await mailApi.setDraftEditorActive(accountId, draftId.current, editorToken.current, true);
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
        setBody(editor.innerText ?? editor.textContent ?? "");
        setHtmlBody(sanitizeOutgoingHtml(editor.innerHTML));
    }
    async function insertInlineImage(file: File | undefined) {
        if (!file || !editorRef.current || busyRef.current) return;
        if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024) {
            setError("Inline images must be PNG, JPEG, GIF, or WebP and no larger than 2 MB.");
            return;
        }
        if (editorRef.current.querySelectorAll("img").length >= 5) {
            setError("Up to five inline images are supported per message.");
            return;
        }
        try {
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () => reject(new Error("Could not read image"));
                reader.readAsDataURL(file);
            });
            if (!editorRef.current || busyRef.current) return;
            if (editorRef.current.querySelectorAll("img").length >= 5) {
                setError("Up to five inline images are supported per message.");
                return;
            }
            editorRef.current.focus();
            const image = document.createElement("img");
            image.src = dataUrl;
            image.alt = file.name;
            image.style.maxWidth = "100%";
            image.style.maxHeight = "240px";
            // Insert via DOM rather than execCommand('insertHTML'), which would
            // treat the filename as markup. onRichInput sanitizes the result.
            const selection = window.getSelection();
            if (selection?.rangeCount && editorRef.current.contains(selection.anchorNode)) {
                const range = selection.getRangeAt(0);
                range.deleteContents();
                range.insertNode(image);
                range.setStartAfter(image);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
            } else {
                editorRef.current.append(image);
            }
            onRichInput();
        } catch (cause) {
            setError(String(cause));
        }
    }

    function formatRich(command: "bold" | "italic" | "underline" | "insertUnorderedList" | "insertOrderedList") {
        editorRef.current?.focus();
        document.execCommand(command);
        onRichInput();
    }

    useEffect(() => {
        contentVersion.current = JSON.stringify([to, cc, bcc, subject, body, htmlBody, attachments, inReplyTo, references]);
    }, [to, cc, bcc, subject, body, htmlBody, attachments, inReplyTo, references]);

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
    const hasContent = Boolean(
        to.trim() || cc.trim() || bcc.trim() || subject.trim() || body.trim() || (htmlBody && /<img\b/i.test(htmlBody)) || attachments.length,
    );
    // A cleared *existing* draft is an edit, not a request to abandon it.
    // Otherwise deleting every field would leave stale content in SQLite/IMAP.
    const shouldPersist = hasContent || hasSavedLocal.current;
    // One ordered queue prevents an older in-flight autosave from replacing a
    // newer snapshot (especially while closing the compose window).
    const persist = useCallback((snapshot: LocalDraft): Promise<void> => {
        const job = lastSave.current
            .catch(() => undefined)
            .then(async () => {
                await mailApi.saveLocalDraft(snapshot);
                hasSavedLocal.current = true;
            });
        lastSave.current = job;
        return job;
    }, []);
    const saveDraft = async (): Promise<boolean> => {
        if (!account || !(hasContent || hasSavedLocal.current)) return true;
        setDraftState("saving");
        const job = persist(draft());
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
        if (loading || !account || busy || !shouldPersist) return;
        setDraftState("idle");
        setServerDraftState((state) => (state === "syncing" ? state : "idle"));
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
            const job = persist(snapshot);
            void job
                .then(async () => {
                    setDraftState("saved");
                    await emit("mail:drafts-updated", { accountId }).catch(() => undefined);
                })
                .catch((cause) => setError(`Could not save local draft: ${String(cause)}`));
        }, 900);
        return () => window.clearTimeout(timer);
    }, [loading, account, busy, shouldPersist, accountId, to, cc, bcc, subject, body, htmlBody, attachments, inReplyTo, references, persist]);

    // Remote failures must not interrupt the independent SQLite autosave queue.
    useEffect(() => {
        if (loading || !account || busy || !shouldPersist) return;
        const uploadVersion = JSON.stringify([to, cc, bcc, subject, body, htmlBody, attachments, inReplyTo, references]);
        const timer = window.setTimeout(() => {
            if (busyRef.current || serverSyncInFlight.current) return;
            serverSyncInFlight.current = true;
            // APPEND can succeed even when its confirmation is lost.
            hasSyncedRemote.current = true;
            void lastSave.current
                .then(() => mailApi.syncRemoteDraft(account.id, draftId.current))
                .then(() => {
                    hasSyncedRemote.current = true;
                    setServerDraftState(contentVersion.current === uploadVersion ? "synced" : "idle");
                })
                .catch(() => {
                    setServerDraftState("idle");
                })
                .finally(() => {
                    serverSyncInFlight.current = false;
                });
        }, 6500);
        return () => window.clearTimeout(timer);
    }, [loading, account, busy, shouldPersist, to, cc, bcc, subject, body, htmlBody, attachments, inReplyTo, references]);

    async function closeComposer() {
        if (busyRef.current || serverSyncInFlight.current) return;
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

    async function syncToServer() {
        if (!account || !shouldPersist || busyRef.current || serverSyncInFlight.current) return;
        serverSyncInFlight.current = true;
        setServerDraftState("syncing");
        const uploadingVersion = contentVersion.current;
        setError(null);
        try {
            if (!(await saveDraft())) {
                setServerDraftState("idle");
                return;
            }
            // An ambiguous APPEND may still have created a server copy.
            hasSyncedRemote.current = true;
            await mailApi.syncRemoteDraft(account.id, draftId.current);
            hasSyncedRemote.current = true;
            setServerDraftState(contentVersion.current === uploadingVersion ? "synced" : "idle");
        } catch (cause) {
            setError(`Could not sync Drafts folder: ${String(cause)}`);
            setServerDraftState("idle");
        } finally {
            serverSyncInFlight.current = false;
        }
    }

    async function send() {
        if (!account || !to.trim() || busyRef.current || serverSyncInFlight.current) return;
        busyRef.current = true;
        setBusy(true);
        setError(null);
        try {
            if (!(await saveDraft())) {
                busyRef.current = false;
                setBusy(false);
                return;
            }
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
            // Remote cleanup only touches versions tagged with this draft UUID,
            // and may fail harmlessly on a disconnected/UIDPLUS-less server.
            if (hasSyncedRemote.current || existingDraftId) {
                await mailApi.deleteRemoteDraft(account.id, draftId.current).catch(() => undefined);
            }
            await mailApi.deleteLocalDraft(account.id, draftId.current).catch(() => undefined);
            await emit("mail:drafts-updated", { accountId: account.id }).catch(() => undefined);
            await emit("mail:sent", { accountId: account.id }).catch(() => undefined);
            await getCurrentWindow()
                .close()
                .catch(() => undefined);
        } catch (e) {
            setError(String(e));
            setBusy(false);
            busyRef.current = false;
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
                <Button
                    type="button"
                    variant={rich ? "ghost" : "secondary"}
                    size="xs"
                    aria-pressed={!rich}
                    onClick={disableRich}
                >
                    Plain text
                </Button>
                <Button
                    type="button"
                    variant={rich ? "secondary" : "ghost"}
                    size="xs"
                    aria-pressed={rich}
                    onClick={enableRich}
                >
                    Rich text
                </Button>
                {rich && (
                    <div className="ml-auto flex gap-1">
                        <input
                            ref={inlineImageInput}
                            type="file"
                            accept="image/png,image/jpeg,image/gif,image/webp"
                            className="hidden"
                            tabIndex={-1}
                            aria-label="Select inline image"
                            onChange={(event) => {
                                void insertInlineImage(event.target.files?.[0]);
                                event.target.value = "";
                            }}
                        />
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            title="Insert inline image"
                            onClick={() => inlineImageInput.current?.click()}
                        >
                            <ImagePlus className="size-4" />
                        </Button>
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
                            title="Underline"
                            onClick={() => formatRich("underline")}
                        >
                            <Underline className="size-4" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            title="Bulleted list"
                            onClick={() => formatRich("insertUnorderedList")}
                        >
                            <List className="size-4" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            title="Numbered list"
                            onClick={() => formatRich("insertOrderedList")}
                        >
                            <ListOrdered className="size-4" />
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
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                className="size-5"
                                onClick={() => setAttachments((items) => items.filter((item) => item !== path))}
                                aria-label="Remove attachment"
                            >
                                <X className="size-3.5 text-muted-foreground" />
                            </Button>
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
                    {serverDraftState === "synced"
                        ? "Saved locally and in IMAP Drafts"
                        : serverDraftState === "syncing"
                          ? "Uploading to IMAP Drafts…"
                          : draftState === "saved"
                            ? "Saved locally"
                            : draftState === "saving"
                              ? "Saving draft…"
                              : "Drafts are saved locally"}
                </span>
                <Button
                    variant="ghost"
                    onClick={() => void syncToServer()}
                    disabled={!account || !hasContent || busy || serverDraftState === "syncing"}
                    title="Upload your local draft to the configured IMAP Drafts folder (requires UIDPLUS and a recipient)"
                >
                    {serverDraftState === "syncing" ? <LoaderCircle className="animate-spin" /> : <CloudUpload />} Sync draft
                </Button>
                <Button
                    variant="ghost"
                    onClick={() => void chooseAttachments()}
                    disabled={busy}
                >
                    <Paperclip /> Attach
                </Button>
                <Button
                    onClick={() => void send()}
                    disabled={busy || serverDraftState === "syncing" || !account || !to.trim()}
                >
                    {busy ? <LoaderCircle className="animate-spin" /> : <Send />} Send
                </Button>
            </footer>
        </main>
    );
}
