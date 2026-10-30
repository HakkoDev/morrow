import { FileText, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { mailApi } from "@/lib/mail-api";
import type { LocalDraft } from "@/lib/types";
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
    useEffect(() => {
        if (!open || !accountId) return;
        let disposed = false;
        void mailApi
            .listLocalDrafts(accountId)
            .then((items) => {
                if (!disposed) setDrafts(items);
            })
            .catch((error) => {
                if (!disposed) onError(String(error));
            });
        return () => {
            disposed = true;
        };
    }, [open, accountId, onError]);
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
                    <DialogDescription>Unsent mail saved on this device. Drafts are not yet synchronized with your mail provider.</DialogDescription>
                </DialogHeader>
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
            </DialogContent>
        </Dialog>
    );
}
