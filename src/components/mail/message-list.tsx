import { Archive, Download, FolderInput, LoaderCircle, MailCheck, MailWarning, RefreshCw, Search, Star, Trash2 } from "lucide-react";
import { type KeyboardEvent, type MouseEvent, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { folderLabel } from "@/lib/folder-labels";
import { usePreferences } from "@/lib/preferences";
import type { MessageSummary } from "@/lib/types";
import { cn, formatDate, initials } from "@/lib/utils";

export type MessageAction = "delete" | "spam" | "read" | "unread" | "star" | "unstar" | "archive" | "save" | `move:${string}`;
interface Props {
    accountId: string;
    folder: string;
    messages: MessageSummary[];
    selectedId?: number | null;
    selection: number[];
    loading: boolean;
    query: string;
    folders: string[];
    onQueryChange: (query: string) => void;
    onSelect: (message: MessageSummary) => void;
    onSelectionChange: (ids: number[]) => void;
    onAction: (action: MessageAction, ids: number[]) => void;
    onSync: () => void;
    onLoadOlder: () => void;
    canLoadOlder: boolean;
}

export function MessageList(props: Props) {
    const {
        accountId,
        folder,
        messages,
        selectedId,
        selection,
        loading,
        query,
        folders,
        onQueryChange,
        onSelect,
        onSelectionChange,
        onAction,
        onSync,
        onLoadOlder,
        canLoadOlder,
    } = props;
    const preferences = usePreferences();
    const lastClicked = useRef<number>(-1);
    const scrollRef = useRef<HTMLElement>(null);
    const previousMailbox = useRef({ accountId, folder });
    const [isNearBottom, setIsNearBottom] = useState(false);
    const [menu, setMenu] = useState<{ x: number; y: number; ids: number[] } | null>(null);
    useEffect(() => {
        if (!menu) return;
        const dismiss = () => setMenu(null);
        const onEscapeKey = (event: globalThis.KeyboardEvent) => {
            if (event.key === "Escape") dismiss();
        };
        document.addEventListener("pointerdown", dismiss);
        document.addEventListener("keydown", onEscapeKey);
        window.addEventListener("blur", dismiss);
        return () => {
            document.removeEventListener("pointerdown", dismiss);
            document.removeEventListener("keydown", onEscapeKey);
            window.removeEventListener("blur", dismiss);
        };
    }, [menu]);

    const checkScroll = useCallback(() => {
        const element = scrollRef.current;
        if (!element) return;
        setIsNearBottom(element.scrollHeight > element.clientHeight + 1 && element.scrollHeight - element.scrollTop - element.clientHeight < 220);
    }, []);
    // No load-more button: advance the IMAP cache window when approaching the end.
    // Loading and the end-of-mailbox guard live in App so this never floods IMAP.
    useEffect(() => {
        if (isNearBottom && canLoadOlder && !loading && !query && messages.length > 0) {
            setIsNearBottom(false);
            onLoadOlder();
        }
    }, [isNearBottom, canLoadOlder, loading, query, messages.length, onLoadOlder]);
    // Re-evaluate when cached rows arrive or additional history is appended.
    // Read the count inside the effect so the dependency reflects the work.
    useEffect(() => {
        if (messages.length === 0) {
            setIsNearBottom(false);
            return;
        }
        checkScroll();
    }, [checkScroll, messages.length]);
    useEffect(() => {
        // Only reset scroll and selection anchor when the mailbox actually changes.
        const previous = previousMailbox.current;
        if (previous.accountId === accountId && previous.folder === folder) return;
        previousMailbox.current = { accountId, folder };
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
        lastClicked.current = -1;
        setIsNearBottom(false);
    }, [accountId, folder]);
    const allIds = messages.map((item) => item.id);
    const allSelected = allIds.length > 0 && allIds.every((id) => selection.includes(id));
    function handleClick(event: MouseEvent<HTMLButtonElement>, message: MessageSummary, index: number) {
        if (event.shiftKey && lastClicked.current >= 0) {
            const start = Math.min(lastClicked.current, index);
            const end = Math.max(lastClicked.current, index);
            const ids = messages.slice(start, end + 1).map((item) => item.id);
            onSelectionChange(Array.from(new Set([...(event.ctrlKey || event.metaKey ? selection : []), ...ids])));
        } else if (event.ctrlKey || event.metaKey) {
            onSelectionChange(selection.includes(message.id) ? selection.filter((id) => id !== message.id) : [...selection, message.id]);
            lastClicked.current = index;
        } else {
            onSelectionChange([message.id]);
            onSelect(message);
            lastClicked.current = index;
        }
    }
    function handleRowKeyDown(event: KeyboardEvent<HTMLButtonElement>, message: MessageSummary) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
            event.preventDefault();
            onSelectionChange(allIds);
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            onSelectionChange([]);
            return;
        }
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            const ids = selection.includes(message.id) ? selection : [message.id];
            if (!selection.includes(message.id)) onSelectionChange(ids);
            setMenu({ x: rect.left + 20, y: rect.top + 20, ids });
        }
    }
    function openMenu(event: MouseEvent<HTMLElement>, message: MessageSummary) {
        event.preventDefault();
        const ids = selection.includes(message.id) ? selection : [message.id];
        if (!selection.includes(message.id)) onSelectionChange(ids);
        setMenu({ x: Math.min(event.clientX, window.innerWidth - 236), y: Math.min(event.clientY, window.innerHeight - 340), ids });
    }
    function run(action: MessageAction, ids = selection) {
        setMenu(null);
        if (ids.length) onAction(action, ids);
    }

    return (
        <section className="flex h-full min-h-0 min-w-0 flex-col border-r border-border bg-background/70">
            <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
                <div className="min-w-0">
                    <h1 className="truncate text-sm font-semibold">{folderLabel(folder)}</h1>
                    <p className="text-[10px] text-muted-foreground">
                        {selection.length ? `${selection.length} selected` : `${messages.length} cached messages`}
                    </p>
                </div>
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    onClick={onSync}
                    disabled={loading}
                    aria-label="Refresh this folder"
                    title="Refresh this folder"
                >
                    {loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                </Button>
            </div>
            <div className="shrink-0 border-b border-border p-3">
                <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        className="h-8 pl-8 text-xs"
                        value={query}
                        onChange={(e) => onQueryChange(e.target.value)}
                        placeholder="Search cached mail"
                        aria-label="Search cached messages"
                    />
                </div>
            </div>
            {selection.length > 1 && (
                <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/20 px-3 py-2 text-xs">
                    <button
                        type="button"
                        className="cursor-pointer text-primary underline"
                        onClick={() => onSelectionChange(allSelected ? [] : allIds)}
                    >
                        {allSelected ? "Clear selection" : "Select all"}
                    </button>
                    <span className="flex-1" />{" "}
                    <button
                        type="button"
                        onClick={() => run("read")}
                        className="cursor-pointer"
                        title="Mark as read"
                    >
                        <MailCheck className="size-4" />
                    </button>
                    <button
                        type="button"
                        onClick={() => run("delete")}
                        className="cursor-pointer text-destructive"
                        title="Delete selected"
                    >
                        <Trash2 className="size-4" />
                    </button>
                </div>
            )}
            <section
                ref={scrollRef}
                onScroll={checkScroll}
                aria-label="Message list. Control A selects all messages. Shift click selects a range."
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            >
                {messages.length === 0 ? (
                    <div className="flex h-40 items-center justify-center px-6 text-center text-xs text-muted-foreground">
                        {loading ? "Loading cached mail…" : "No cached messages in this folder yet. Background sync will populate it when available."}
                    </div>
                ) : (
                    <div className="divide-y divide-border/70">
                        {messages.map((message, index) => {
                            const unread = !message.flags.some((flag) => flag.replace(/^\\/, "") === "Seen");
                            const starred = message.flags.some((flag) => flag.replace(/^\\/, "") === "Flagged");
                            const selected = selection.includes(message.id);
                            return (
                                <button
                                    key={message.id}
                                    type="button"
                                    aria-pressed={selected}
                                    onClick={(event) => handleClick(event, message, index)}
                                    onContextMenu={(event) => openMenu(event, message)}
                                    onKeyDown={(event) => handleRowKeyDown(event, message)}
                                    className={cn(
                                        "grid w-full cursor-pointer grid-cols-[38px_1fr] gap-2 px-3 py-3 text-left transition hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring",
                                        preferences.density === "compact" && "py-1.5",
                                        (selected || selectedId === message.id) && "bg-accent/80",
                                        unread && !selected && "bg-primary/[0.045]",
                                    )}
                                >
                                    <div className="flex size-8 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold">
                                        {initials(message.sender)}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className={cn("min-w-0 flex-1 truncate text-xs", unread ? "font-semibold text-foreground" : "font-medium")}>
                                                {message.sender || "Unknown sender"}
                                            </span>
                                            {starred && <Star className="size-3 fill-current text-primary" />}
                                            <span className="shrink-0 text-[10px] text-muted-foreground">{formatDate(message.date)}</span>
                                        </div>
                                        <div className={cn("mt-0.5 truncate text-xs", unread ? "font-semibold" : "text-foreground/85")}>
                                            {message.subject || "(no subject)"}
                                        </div>
                                        {preferences.showPreviews && (
                                            <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{message.preview}</div>
                                        )}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
                {canLoadOlder && loading && messages.length > 0 && (
                    <div
                        aria-live="polite"
                        className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground"
                    >
                        <LoaderCircle className="size-3.5 animate-spin" /> Syncing messages…
                    </div>
                )}
            </section>
            {menu && (
                <div
                    role="menu"
                    aria-label="Message actions"
                    className="morrow-popover fixed z-[100] w-56 max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-popover p-1 text-xs text-popover-foreground shadow-2xl"
                    style={{ left: Math.max(4, menu.x), top: Math.max(4, menu.y) }}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    {(
                        [
                            ["read", "Mark as read", MailCheck],
                            ["unread", "Mark as unread", MailWarning],
                            ["star", "Star", Star],
                            ["unstar", "Remove star", Star],
                            ["archive", "Archive", Archive],
                            ["spam", "Mark as spam", MailWarning],
                            ["delete", "Delete", Trash2],
                            ["save", "Save as .eml", Download],
                        ] as const
                    ).map(([action, name, Icon]) => (
                        <button
                            key={action}
                            type="button"
                            role="menuitem"
                            disabled={action === "save" && menu.ids.length !== 1}
                            onClick={() => run(action, menu.ids)}
                            className="flex w-full cursor-pointer items-center gap-2 rounded px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            <Icon className="size-4" /> {name}
                        </button>
                    ))}
                    {folders.filter((name) => name !== folder).length > 0 && (
                        <>
                            <div className="my-1 border-t border-border" />
                            <div className="px-3 py-1.5 text-[10px] text-muted-foreground">Move to folder</div>
                            {folders
                                .filter((name) => name !== folder)
                                .map((name) => (
                                    <button
                                        key={name}
                                        type="button"
                                        role="menuitem"
                                        onClick={() => run(`move:${name}`, menu.ids)}
                                        className="flex w-full cursor-pointer items-center gap-2 rounded px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                                    >
                                        <FolderInput className="size-4" />
                                        <span className="truncate">{folderLabel(name)}</span>
                                    </button>
                                ))}
                        </>
                    )}
                </div>
            )}
        </section>
    );
}
