import { FileText, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { mailApi } from "@/lib/mail-api";
import type { DraftSyncStatus, ExternalDraftSummary, LocalDraft } from "@/lib/types";
import { formatDate } from "@/lib/utils";

interface Props {
    open: boolean;
    accountId: string;
    onOpenChange: (open: boolean) => void;
    onResume: (draft: LocalDraft) => void;
    onError: (error: string) => void;
}
export function LocalDraftsDialog({ open, accountId, onOpenChange, onResume, onError }: Props) {
    const [drafts, setDrafts] = useState<LocalDraft[]>([]);
    const [busy, setBusy] = useState(false);
    const [statuses, setStatuses] = useState<Record<string, DraftSyncStatus>>({});
    const [lastSync, setLastSync] = useState("");
    const [external, setExternal] = useState<ExternalDraftSummary[] | null>(null);
    async function load() {
        const [items, states] = await Promise.all([mailApi.listLocalDrafts(accountId), mailApi.draftSyncStatuses(accountId)]);
        setDrafts(items);
        setStatuses(states);
    }
    async function refresh() {
        if (busy || !accountId) return;
        setBusy(true);
        try {
            const result = await mailApi.refreshRemoteDrafts(accountId);
            await load();
            setLastSync(`${result.uploaded} uploaded, ${result.downloaded} downloaded, ${result.conflicts} conflicts`);
        } catch (error) {
            onError(String(error));
        } finally {
            setBusy(false);
        }
    }
    useEffect(() => {
        if (!open || !accountId) return;
        setExternal(null);
        let disposed = false;
        void Promise.all([mailApi.listLocalDrafts(accountId), mailApi.draftSyncStatuses(accountId)])
            .then(([items, states]) => {
                if (!disposed) {
                    setDrafts(items);
                    setStatuses(states);
                }
            })
            .catch((error) => {
                if (!disposed) onError(String(error));
            });
        return () => {
            disposed = true;
        };
    }, [open, accountId, onError]);
    async function resolve(draft: LocalDraft, choice: "keepLocal" | "keepServer" | "keepLocalOffline") {
        if (busy) return;
        setBusy(true);
        try {
            await mailApi.resolveDraftConflict(draft.accountId, draft.id, choice);
            await load();
            setLastSync("Conflict resolved. Backup retained in local drafts.");
        } catch (error) {
            onError(String(error));
        } finally {
            setBusy(false);
        }
    }
    async function loadExternal() {
        if (busy) return;
        setBusy(true);
        try {
            setExternal(await mailApi.listExternalDrafts(accountId));
        } catch (error) {
            onError(String(error));
        } finally {
            setBusy(false);
        }
    }
    async function importCopy(entry: ExternalDraftSummary) {
        if (busy) return;
        setBusy(true);
        try {
            await mailApi.importExternalDraft(accountId, entry.uid, entry.uidValidity);
            await load();
            setLastSync("Imported a separate local copy. The original server draft was not changed.");
        } catch (error) {
            onError(String(error));
        } finally {
            setBusy(false);
        }
    }
    async function remove(draft: LocalDraft) {
        if (busy) return;
        setBusy(true);
        try {
            await mailApi.deleteLocalDraft(draft.accountId, draft.id);
            setDrafts((items) => items.filter((item) => item.id !== draft.id));
        } catch (error) {
            onError(String(error));
        } finally {
            setBusy(false);
        }
    }
    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
        >
            <DialogContent className="max-h-[80vh] max-w-xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Local drafts</DialogTitle>
                    <DialogDescription>
                        Morrow-owned IMAP drafts synchronize when online. Local copies remain available offline. Drafts from other clients can be imported as
                        separate copies without modifying their originals. Conflicting changes are preserved.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex items-center justify-between gap-3">
                    <p
                        className="text-xs text-muted-foreground"
                        aria-live="polite"
                    >
                        {lastSync || "Background check every 3 minutes"}
                    </p>
                    <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => void refresh()}
                    >
                        <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} /> Refresh Drafts
                    </Button>
                </div>
                <div className="space-y-2">
                    {drafts.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No saved drafts for this account.</p>}
                    {drafts.map((draft) => (
                        <div
                            key={draft.id}
                            className="flex items-center gap-3 rounded-lg border border-border p-3"
                        >
                            <FileText className="size-5 shrink-0 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">{draft.subject || "(No subject)"}</p>
                                <p className="truncate text-xs text-muted-foreground">
                                    {draft.to || "No recipient"} · {formatDate(draft.updatedAt)}
                                </p>
                                {statuses[draft.id] && (
                                    <p
                                        className={`text-xs ${statuses[draft.id].status === "synced" ? "text-muted-foreground" : "text-destructive"}`}
                                        title={statuses[draft.id].note}
                                    >
                                        {statuses[draft.id].status === "synced" ? "Synchronized" : `${statuses[draft.id].status}: ${statuses[draft.id].note}`}
                                    </p>
                                )}
                                {statuses[draft.id]?.status === "conflict" && (
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={busy}
                                            onClick={() => void resolve(draft, "keepLocal")}
                                        >
                                            Keep local
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={busy}
                                            onClick={() => void resolve(draft, "keepServer")}
                                        >
                                            Use server
                                        </Button>
                                    </div>
                                )}
                                {statuses[draft.id]?.status === "remote-missing" && (
                                    <Button
                                        className="mt-2"
                                        variant="outline"
                                        size="sm"
                                        disabled={busy}
                                        onClick={() => void resolve(draft, "keepLocalOffline")}
                                    >
                                        Restore on server
                                    </Button>
                                )}
                            </div>
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Continue draft"
                                onClick={() => onResume(draft)}
                            >
                                <Pencil className="size-4" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Delete draft"
                                disabled={busy}
                                onClick={() => void remove(draft)}
                            >
                                <Trash2 className="size-4" />
                            </Button>
                        </div>
                    ))}
                </div>
                <section
                    className="mt-5 space-y-2 border-t border-border pt-4"
                    aria-label="Drafts from other clients"
                >
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="text-sm font-semibold">Drafts from other apps</p>
                            <p className="text-xs text-muted-foreground">
                                Import a separate local copy from Gmail, Outlook or another IMAP client. The server original is never changed.
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => void loadExternal()}
                        >
                            <RefreshCw className="size-4" /> {external === null ? "Find drafts" : "Reload"}
                        </Button>
                    </div>
                    {external !== null && external.length === 0 && <p className="text-sm text-muted-foreground">No drafts from other clients found.</p>}
                    {external?.map((item) => (
                        <div
                            key={`${item.uidValidity}:${item.uid}`}
                            className="flex items-center gap-3 rounded-lg border border-border p-3"
                        >
                            <FileText className="size-5 shrink-0 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">{item.subject || "(No subject)"}</p>
                                <p className="truncate text-xs text-muted-foreground">
                                    {item.to || "No recipient"} · {item.from || "Unknown sender"}
                                </p>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() => void importCopy(item)}
                            >
                                Import copy
                            </Button>
                        </div>
                    ))}
                </section>
            </DialogContent>
        </Dialog>
    );
}
