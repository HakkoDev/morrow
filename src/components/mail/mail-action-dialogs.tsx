import { type FormEvent, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface ConfirmActionProps {
    open: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    busy: boolean;
    onClose: () => void;
    onConfirm: () => void;
}
export function ConfirmActionDialog({ open, title, description, confirmLabel, busy, onClose, onConfirm }: ConfirmActionProps) {
    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next && !busy) onClose();
            }}
        >
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                <div className="flex justify-end gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={onClose}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        disabled={busy}
                        onClick={onConfirm}
                    >
                        {busy ? "Working…" : confirmLabel}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

interface CreateFolderProps {
    open: boolean;
    accountEmail: string;
    onClose: () => void;
    onCreate: (name: string) => Promise<void>;
}
export function CreateFolderDialog({ open, accountEmail, onClose, onCreate }: CreateFolderProps) {
    const id = useId();
    const [name, setName] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => {
        if (!open) {
            setName("");
            setError("");
        }
    }, [open]);
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!name.trim() || busy) return;
        setBusy(true);
        setError("");
        try {
            await onCreate(name.trim());
            onClose();
        } catch (cause) {
            setError(String(cause));
        } finally {
            setBusy(false);
        }
    }
    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next && !busy) onClose();
            }}
        >
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Create folder</DialogTitle>
                    <DialogDescription>Create a folder in {accountEmail}. Your mail provider may use a folder separator for nested folders.</DialogDescription>
                </DialogHeader>
                <form
                    onSubmit={(event) => void submit(event)}
                    className="space-y-4"
                >
                    <div className="space-y-2">
                        <label
                            htmlFor={id}
                            className="block text-sm font-medium"
                        >
                            Folder name
                        </label>
                        <Input
                            id={id}
                            autoFocus
                            maxLength={180}
                            required
                            placeholder="e.g. Receipts"
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            disabled={busy}
                        />
                    </div>
                    {error && (
                        <p
                            role="alert"
                            className="text-sm text-destructive"
                        >
                            {error}
                        </p>
                    )}
                    <div className="flex justify-end gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={onClose}
                            disabled={busy}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={busy || !name.trim()}
                        >
                            {busy ? "Creating…" : "Create folder"}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
