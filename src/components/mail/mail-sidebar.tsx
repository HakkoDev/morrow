import {
    Archive,
    ChevronDown,
    FilePlus2,
    FileText,
    Inbox,
    Layers3,
    Mail,
    PenLine,
    RefreshCw,
    Send,
    Settings,
    SlidersHorizontal,
    Star,
    Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { folderLabel } from "@/lib/folder-labels";
import type { Account, Folder } from "@/lib/types";
import { cn, initials } from "@/lib/utils";

interface Props {
    accounts: Account[];
    account: Account | null;
    folders: Folder[];
    favorites: string[];
    unreadCounts: Record<string, number>;
    onToggleFavorite: (folder: string) => void;
    folder: string;
    unified: boolean;
    onUnifiedInbox: () => void;
    onLocalDrafts: () => void;
    onAccountChange: (account: Account) => void;
    onManageAccounts: () => void;
    onFolderChange: (folder: string) => void;
    onCreateFolder: () => void;
    onRemoveFolder: (folder: string) => void;
    onCompose: () => void;
    onSettings: () => void;
    onUpdates: () => void;
    updatesAvailable: boolean;
    updatesChecking: boolean;
}

function folderIcon(name: string) {
    const lower = name.toLowerCase();
    if (lower === "inbox") return Inbox;
    if (lower.includes("sent")) return Send;
    if (lower.includes("draft")) return FileText;
    if (lower.includes("trash") || lower.includes("deleted")) return Trash2;
    if (lower.includes("archive")) return Archive;
    return Mail;
}

export function MailSidebar(props: Props) {
    const [open, setOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const outside = (event: PointerEvent) => {
            if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
        };
        const onEscapeKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false);
        };
        window.addEventListener("pointerdown", outside);
        window.addEventListener("keydown", onEscapeKey);
        return () => {
            window.removeEventListener("pointerdown", outside);
            window.removeEventListener("keydown", onEscapeKey);
        };
    }, [open]);

    const systemFolder = (item: Folder) =>
        item.name.toUpperCase() === "INBOX" ||
        [props.account?.sentFolder, props.account?.trashFolder, props.account?.draftsFolder].some((name) => name?.toLowerCase() === item.name.toLowerCase()) ||
        item.attributes.some((attr) =>
            ["Sent", "Drafts", "Trash", "Junk", "Archive", "All", "Flagged"].some((special) => special.toLowerCase() === attr.toLowerCase()),
        );

    return (
        <aside className="flex h-full min-h-0 min-w-0 flex-col border-r border-border bg-card/60 backdrop-blur-xl">
            <div className="flex h-14 shrink-0 items-center gap-2 px-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-sm font-bold text-primary">M</div>
                <div className="min-w-0 flex-1 truncate text-sm font-semibold">Morrow</div>
                <Button
                    variant="ghost"
                    size="icon"
                    className="relative size-8 shrink-0"
                    onClick={props.onUpdates}
                    title="Check for updates"
                    aria-label="Check for updates"
                >
                    <RefreshCw className={props.updatesChecking ? "animate-spin" : ""} />
                    {props.updatesAvailable && <span className="absolute right-0 top-0 size-2 rounded-full bg-primary" />}
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    onClick={props.onSettings}
                    title="Preferences"
                    aria-label="Preferences"
                >
                    <Settings />
                </Button>
            </div>
            <div className="shrink-0 px-3 pb-3">
                <Button
                    className="w-full justify-start"
                    onClick={props.onCompose}
                >
                    <PenLine /> Compose
                </Button>
            </div>
            <div
                className="relative shrink-0 px-3 pb-3"
                ref={menuRef}
            >
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Account</div>
                <button
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-border bg-background/60 p-2 text-left transition hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                    onClick={() => setOpen(!open)}
                    aria-haspopup="menu"
                    aria-expanded={open}
                    aria-label="Choose or manage a mail account"
                >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
                        {initials(props.account?.displayName || props.account?.email || "M")}
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">{props.account?.displayName || props.account?.email || "No account"}</span>
                        <span className="block truncate text-[10px] text-muted-foreground">{props.account?.email}</span>
                    </span>
                    <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-150", open && "rotate-180")} />
                </button>
                {open && (
                    <div
                        className="morrow-popover absolute right-3 left-3 top-full z-40 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-xl"
                        role="menu"
                        aria-label="Mail accounts"
                    >
                        {props.accounts.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                role="menuitemradio"
                                aria-checked={item.id === props.account?.id}
                                className={cn(
                                    "flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left text-xs hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                                    item.id === props.account?.id && "bg-accent/50 font-semibold",
                                )}
                                onClick={() => {
                                    setOpen(false);
                                    if (item.id !== props.account?.id) props.onAccountChange(item);
                                }}
                            >
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate font-medium">{item.displayName || item.email}</span>
                                    <span className="block truncate text-[11px] text-muted-foreground">{item.email}</span>
                                </span>
                                {(props.unreadCounts[item.id] ?? 0) > 0 && (
                                    <span
                                        className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary"
                                        title="Cached unread mail"
                                    >
                                        {props.unreadCounts[item.id]}
                                    </span>
                                )}
                                {item.id === props.account?.id && <span aria-hidden="true">✓</span>}
                            </button>
                        ))}
                        <div className="my-1 border-t border-border" />
                        <button
                            type="button"
                            role="menuitem"
                            className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-xs hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                            onClick={() => {
                                setOpen(false);
                                props.onManageAccounts();
                            }}
                        >
                            <SlidersHorizontal className="size-4" /> Manage accounts
                        </button>
                    </div>
                )}
            </div>
            <div className="shrink-0 space-y-1 px-3 pb-2">
                <button
                    type="button"
                    aria-current={props.unified ? "page" : undefined}
                    onClick={props.onUnifiedInbox}
                    className={cn(
                        "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left text-xs transition hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
                        props.unified && "bg-accent font-medium",
                    )}
                >
                    <Layers3 className="size-4" /> Unified Inbox
                </button>
                <button
                    type="button"
                    onClick={props.onLocalDrafts}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                >
                    <FileText className="size-4" /> Local drafts
                </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3">
                <div className="flex shrink-0 items-center justify-between py-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Folders</div>
                    <button
                        type="button"
                        onClick={props.onCreateFolder}
                        aria-label="Create folder"
                        title="Create folder"
                        className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                    >
                        <FilePlus2 className="size-4" />
                    </button>
                </div>
                <nav
                    className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4"
                    aria-label="Mail folders"
                >
                    {props.folders
                        .filter((item) => item.selectable)
                        .sort((a, b) => Number(props.favorites.includes(b.name)) - Number(props.favorites.includes(a.name)))
                        .map((item) => {
                            const Icon = folderIcon(item.name);
                            return (
                                <div
                                    key={item.name}
                                    className="group flex items-center gap-0.5 rounded-md hover:bg-accent/60"
                                >
                                    <button
                                        type="button"
                                        aria-current={props.folder === item.name ? "page" : undefined}
                                        onClick={() => {
                                            if (props.folder !== item.name) props.onFolderChange(item.name);
                                        }}
                                        className={cn(
                                            "flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left text-xs transition focus-visible:outline-2 focus-visible:outline-ring",
                                            props.folder === item.name
                                                ? "bg-accent font-medium text-foreground"
                                                : "text-muted-foreground hover:text-foreground",
                                        )}
                                    >
                                        <Icon className="size-4 shrink-0" />
                                        <span
                                            className="truncate"
                                            title={item.name}
                                        >
                                            {folderLabel(item.name, item.delimiter)}
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        aria-label={`${props.favorites.includes(item.name) ? "Unfavorite" : "Favorite"} ${folderLabel(item.name, item.delimiter)}`}
                                        aria-pressed={props.favorites.includes(item.name)}
                                        onClick={() => props.onToggleFavorite(item.name)}
                                        className="cursor-pointer rounded p-1.5 text-muted-foreground transition hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
                                    >
                                        <Star className={`size-3.5 ${props.favorites.includes(item.name) ? "fill-current text-primary" : ""}`} />
                                    </button>
                                    {!systemFolder(item) && (
                                        <button
                                            type="button"
                                            aria-label={`Delete folder ${folderLabel(item.name, item.delimiter)}`}
                                            title={`Delete ${folderLabel(item.name, item.delimiter)}`}
                                            className="cursor-pointer rounded p-1.5 text-muted-foreground opacity-0 hover:text-destructive focus:opacity-100 focus-visible:outline-2 focus-visible:outline-ring group-hover:opacity-100"
                                            onClick={() => props.onRemoveFolder(item.name)}
                                        >
                                            <Trash2 className="size-3.5" />
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    {props.folders.length === 0 && (
                        <p className="px-2 py-3 text-xs text-muted-foreground">No folders cached yet. Morrow will discover them in the background.</p>
                    )}
                </nav>
            </div>
        </aside>
    );
}
