import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Account } from "@/lib/types";

interface Props {
    open: boolean;
    onOpenChange: (value: boolean) => void;
    accounts: Account[];
    onEdit: (account: Account) => void;
    onAdd: () => void;
    onRemove: (account: Account) => void;
}
export function ManageAccountsDialog({ open, onOpenChange, accounts, onAdd, onEdit, onRemove }: Props) {
    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
        >
            <DialogContent className="max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Manage accounts</DialogTitle>
                    <DialogDescription>
                        Configure your IMAP and SMTP accounts. Removing an account deletes only its local cache and credentials.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                    {accounts.map((item) => (
                        <div
                            key={item.id}
                            className="flex items-center gap-2 rounded-lg border border-border p-3"
                        >
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium">{item.displayName || item.email}</div>
                                <div className="truncate text-xs text-muted-foreground">
                                    {item.email} · {item.imapHost}
                                </div>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onEdit(item)}
                                aria-label={`Edit ${item.email}`}
                            >
                                <Pencil className="size-3.5" /> Edit
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive"
                                onClick={() => onRemove(item)}
                                title={`Remove ${item.email}`}
                                aria-label={`Remove ${item.email}`}
                            >
                                <Trash2 className="size-4" />
                            </Button>
                        </div>
                    ))}
                </div>
                <div className="flex justify-between gap-2 pt-3">
                    <Button onClick={onAdd}>
                        <Plus className="size-4" /> Add account
                    </Button>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                    >
                        Close
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
