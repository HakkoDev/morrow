import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { LoaderCircle, MailPlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccountDialog } from "@/components/mail/account-dialog";
import type { ComposeSeed } from "@/components/mail/compose-window";
import { ConfirmActionDialog, CreateFolderDialog } from "@/components/mail/mail-action-dialogs";
import { MailSidebar } from "@/components/mail/mail-sidebar";
import { ManageAccountsDialog } from "@/components/mail/manage-accounts-dialog";
import { type MessageAction, MessageList } from "@/components/mail/message-list";
import { MessageView } from "@/components/mail/message-view";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { Button } from "@/components/ui/button";
import { UpdateCenter, useMorrowUpdater } from "@/components/updater/update-center";
import { folderLabel } from "@/lib/folder-labels";
import { mailApi } from "@/lib/mail-api";
import { openComposeWindow } from "@/lib/open-compose";
import { usePreferences } from "@/lib/preferences";
import type { Account, Folder, MessageDetail, MessageSummary } from "@/lib/types";

const DEFAULT_FOLDER = "INBOX";
function isRead(flags: string[]) {
    return flags.some((flag) => flag.replace(/^\\/, "") === "Seen");
}

export default function App() {
    const updater = useMorrowUpdater();
    const preferences = usePreferences();
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [manageOpen, setManageOpen] = useState(false);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [account, setAccount] = useState<Account | null>(null);
    const [folders, setFolders] = useState<Folder[]>([]);
    const [folder, setFolder] = useState(DEFAULT_FOLDER);
    const [messages, setMessages] = useState<MessageSummary[]>([]);
    const [selection, setSelection] = useState<number[]>([]);
    const [selected, setSelected] = useState<MessageDetail | null>(null);
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(false);
    const [syncLimit, setSyncLimit] = useState(100);
    const [hasOlderMessages, setHasOlderMessages] = useState(true);
    const loadingOlder = useRef(false);
    const [createFolderOpen, setCreateFolderOpen] = useState(false);
    const [confirmation, setConfirmation] = useState<{ title: string; description: string; label: string; run: () => Promise<void> } | null>(null);
    const [confirmBusy, setConfirmBusy] = useState(false);
    const [initializing, setInitializing] = useState(true);
    const [accountDialog, setAccountDialog] = useState(false);
    const [editingAccount, setEditingAccount] = useState<Account | null>(null);
    const [error, setError] = useState<string | null>(null);

    // The ref is updated synchronously before any account/folder request. Late
    // responses from a previous account must NEVER replace the active mailbox.
    const current = useRef({ accountId: "", folder: DEFAULT_FOLDER, revision: 0 });
    const accountRef = useRef<Account | null>(null);
    const messagesRef = useRef<MessageSummary[]>([]);
    const refreshToken = useRef(0);
    const searchRef = useRef("");
    const messageRequest = useRef(0);
    const setMessageRows = useCallback((rows: MessageSummary[]) => {
        messagesRef.current = rows;
        setMessages(rows);
    }, []);
    const resetView = useCallback(
        (accountId: string, nextFolder: string) => {
            const revision = current.current.revision + 1;
            current.current = { accountId, folder: nextFolder, revision };
            setMessageRows([]);
            setSelection([]);
            setSelected(null);
            setFolder(nextFolder);
            searchRef.current = "";
            messageRequest.current += 1;
            setQuery("");
            setSyncLimit(100);
            setHasOlderMessages(true);
            loadingOlder.current = false;
            setCreateFolderOpen(false);
            setError(null);
            return revision;
        },
        [setMessageRows],
    );

    const loadCached = useCallback(
        async (accountId: string, name: string, search: string, revision: number) => {
            try {
                const rows = await mailApi.listMessages(accountId, name, search);
                if (current.current.accountId !== accountId || current.current.folder !== name || current.current.revision !== revision) return;
                // Also check the returned rows; a stale backend response must never
                // populate a different account's view.
                if (rows.some((row) => row.accountId !== accountId || row.folder !== name))
                    throw new Error("Mailbox cache returned a mismatched account/folder");
                setMessageRows(rows);
                setSelected((old) => (old && !rows.some((row) => row.id === old.id) ? null : old));
                setSelection((previous) => previous.filter((id) => rows.some((row) => row.id === id)));
            } catch (cause) {
                if (current.current.revision === revision) setError(String(cause));
            }
        },
        [setMessageRows],
    );

    const refreshFolderList = useCallback(async (active: Account, revision: number) => {
        try {
            const rows = await mailApi.listFolders(active.id);
            if (current.current.accountId === active.id && current.current.revision === revision) setFolders(rows);
            return rows;
        } catch {
            // Background refresh is best-effort; keep the last SQLite snapshot.
            return [] as Folder[];
        }
    }, []);

    const syncInBackground = useCallback(
        async (accountId: string, name: string, limit: number, revision: number, announceErrors = false): Promise<boolean> => {
            const token = ++refreshToken.current;
            if (announceErrors && current.current.revision === revision) setLoading(true);
            try {
                await mailApi.syncFolder(accountId, name, limit);
                if (current.current.accountId === accountId && current.current.folder === name && current.current.revision === revision) {
                    await loadCached(accountId, name, searchRef.current, revision);
                }
                return true;
            } catch (cause) {
                if (announceErrors && current.current.revision === revision) setError(String(cause));
                return false;
            } finally {
                if (announceErrors && current.current.revision === revision && refreshToken.current === token) setLoading(false);
            }
        },
        [loadCached],
    );

    const activateAccount = useCallback(
        async (next: Account, force = false) => {
            if (!force && accountRef.current?.id === next.id) return;
            accountRef.current = next;
            setAccount(next);
            setFolders([]);
            const revision = resetView(next.id, DEFAULT_FOLDER);
            const [cached] = await Promise.all([mailApi.cachedFolders(next.id).catch(() => [] as Folder[]), loadCached(next.id, DEFAULT_FOLDER, "", revision)]);
            if (current.current.revision !== revision) return;
            if (cached.length) setFolders(cached);
            // Folder discovery runs asynchronously and does not hide the cached Inbox.
            void refreshFolderList(next, revision);
        },
        [resetView, loadCached, refreshFolderList],
    );

    useEffect(() => {
        let cancelled = false;
        void mailApi
            .listAccounts()
            .then(async (rows) => {
                if (cancelled) return;
                setAccounts(rows);
                if (rows[0]) await activateAccount(rows[0]);
            })
            .catch((cause) => {
                if (!cancelled) setError(String(cause));
            })
            .finally(() => {
                if (!cancelled) setInitializing(false);
            });
        return () => {
            cancelled = true;
        };
    }, [activateAccount]);

    useEffect(() => {
        let disposed = false;
        const unlisteners: Array<() => void> = [];
        const subscribe = async () => {
            const mail = await listen<{ accountId: string; folder: string }>("mail:synced", ({ payload }) => {
                const active = current.current;
                if (!disposed && active.accountId === payload.accountId && active.folder.toUpperCase() === payload.folder.toUpperCase()) {
                    void loadCached(active.accountId, active.folder, searchRef.current, active.revision);
                }
            });
            if (disposed) mail();
            else unlisteners.push(mail);
            const folderEvent = await listen<{ accountId: string }>("mail:folders-updated", ({ payload }) => {
                if (disposed || accountRef.current?.id !== payload.accountId) return;
                const revision = current.current.revision;
                void mailApi
                    .cachedFolders(payload.accountId)
                    .then((rows) => {
                        if (!disposed && current.current.accountId === payload.accountId && current.current.revision === revision) setFolders(rows);
                    })
                    .catch(() => undefined);
            });
            if (disposed) folderEvent();
            else unlisteners.push(folderEvent);
        };
        void subscribe().catch((cause) => {
            if (!disposed) setError(String(cause));
        });
        return () => {
            disposed = true;
            for (const unlisten of unlisteners) unlisten();
        };
    }, [loadCached]);

    // Mail selection shortcut is available across the mailbox, not only when a
    // message-row button happens to own keyboard focus. Do not hijack inputs,
    // editable fields, or account/settings dialogs.
    useEffect(() => {
        const selectAll = (event: globalThis.KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "a") return;
            const target = event.target;
            if (target instanceof Element && target.closest('input, textarea, select, [contenteditable], [role="dialog"], [role="menu"]')) return;
            if (!messagesRef.current.length) return;
            event.preventDefault();
            setSelection(messagesRef.current.map((item) => item.id));
        };
        document.addEventListener("keydown", selectAll);
        return () => document.removeEventListener("keydown", selectAll);
    }, []);

    const chooseFolder = useCallback(
        (next: string) => {
            const active = accountRef.current;
            if (!active || current.current.folder === next) return;
            const revision = resetView(active.id, next);
            void loadCached(active.id, next, "", revision);
            // Cache-first: don't block navigation or show an auth error over cached mail.
            void syncInBackground(active.id, next, 100, revision);
        },
        [resetView, loadCached, syncInBackground],
    );

    const setSearch = useCallback(
        (text: string) => {
            searchRef.current = text;
            setQuery(text);
            const active = current.current;
            void mailApi
                .listMessages(active.accountId, active.folder, text)
                .then((rows) => {
                    if (
                        searchRef.current === text &&
                        current.current.revision === active.revision &&
                        current.current.accountId === active.accountId &&
                        rows.every((row) => row.accountId === active.accountId && row.folder === active.folder)
                    )
                        setMessageRows(rows);
                })
                .catch((cause) => {
                    if (current.current.revision === active.revision) setError(String(cause));
                });
        },
        [setMessageRows],
    );

    const sync = useCallback(() => {
        const active = current.current;
        if (!active.accountId) return;
        void syncInBackground(active.accountId, active.folder, syncLimit, active.revision, true);
    }, [syncInBackground, syncLimit]);
    const loadOlder = useCallback(async () => {
        const active = current.current;
        if (!active.accountId || loadingOlder.current || !hasOlderMessages || syncLimit >= 1000 || searchRef.current) return;
        loadingOlder.current = true;
        const before = messagesRef.current.length;
        const limit = Math.min(Math.max(syncLimit, Math.ceil(before / 100) * 100) + 100, 1000);
        setSyncLimit(limit);
        try {
            const succeeded = await syncInBackground(active.accountId, active.folder, limit, active.revision, true);
            if (current.current.revision === active.revision && succeeded) {
                // Do not repeatedly fetch the same last page once the server has no older messages.
                if (messagesRef.current.length <= before || limit >= 1000) setHasOlderMessages(false);
            }
        } finally {
            // A late request must never clear the in-flight guard for a newer mailbox.
            if (current.current.revision === active.revision) loadingOlder.current = false;
        }
    }, [hasOlderMessages, syncLimit, syncInBackground]);

    async function selectMessage(summary: MessageSummary) {
        const request = ++messageRequest.current;
        const active = current.current;
        if (summary.accountId !== active.accountId || summary.folder !== active.folder) return;
        try {
            const detail = await mailApi.getMessage(active.accountId, summary.id);
            if (
                messageRequest.current !== request ||
                current.current.revision !== active.revision ||
                detail.accountId !== active.accountId ||
                detail.folder !== active.folder
            )
                return;
            setSelected(detail);
            if (!isRead(detail.flags) && preferences.markReadOnOpen) {
                try {
                    await mailApi.setMessageFlag(active.accountId, detail.folder, detail.uid, "\\Seen", true);
                    if (current.current.revision === active.revision) {
                        setSelected((old) => (old?.id === detail.id ? { ...old, flags: [...old.flags, "Seen"] } : old));
                        await loadCached(active.accountId, active.folder, query, active.revision);
                    }
                } catch {
                    /* Keep cached messages readable when the server is unavailable. */
                }
            }
        } catch (cause) {
            if (current.current.revision === active.revision) setError(String(cause));
        }
    }

    function compose(seed?: ComposeSeed) {
        if (!accountRef.current) return;
        void openComposeWindow(accountRef.current.id, seed || null).catch((cause) => setError(String(cause)));
    }

    function addAccount() {
        setManageOpen(false);
        setEditingAccount(null);
        setAccountDialog(true);
    }
    function editAccount(item: Account) {
        setManageOpen(false);
        setEditingAccount(item);
        setAccountDialog(true);
    }
    async function handleSaved(saved: Account) {
        const rows = await mailApi.listAccounts();
        setAccounts(rows);
        await activateAccount(saved, true);
        const active = current.current;
        // Account was validated by Rust before saving; warm the cache immediately.
        void syncInBackground(saved.id, DEFAULT_FOLDER, 100, active.revision);
    }
    async function handleDeleted(accountId: string) {
        const rows = await mailApi.listAccounts();
        setAccounts(rows);
        if (current.current.accountId !== accountId) return;
        accountRef.current = null;
        setAccount(null);
        setFolders([]);
        resetView("", DEFAULT_FOLDER);
        if (rows[0]) await activateAccount(rows[0], true);
    }
    function removeAccount(item: Account) {
        setConfirmation({
            title: "Remove account?",
            description: `Remove ${item.email} and its local cached mail from this device? Messages on the mail server will not be deleted.`,
            label: "Remove account",
            run: async () => {
                await mailApi.deleteAccount(item.id);
                await handleDeleted(item.id);
            },
        });
    }

    async function refreshCurrentMessage() {
        const active = current.current;
        const old = selected?.id;
        await loadCached(active.accountId, active.folder, query, active.revision);
        if (!old) return;
        try {
            const detail = await mailApi.getMessage(active.accountId, old);
            if (current.current.revision === active.revision) setSelected(detail);
        } catch {
            if (current.current.revision === active.revision) setSelected(null);
        }
    }

    async function createFolder(name: string) {
        const active = accountRef.current;
        if (!active) throw new Error("Select an account first.");
        if (!name || name.toUpperCase() === "INBOX" || folders.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
            throw new Error("That folder already exists or is reserved.");
        }
        await mailApi.createFolder(active.id, name);
        if (accountRef.current?.id === active.id) await refreshFolderList(active, current.current.revision);
    }
    function removeFolder(name: string) {
        const active = accountRef.current;
        if (!active) return;
        setConfirmation({
            title: "Delete folder?",
            description: `Delete “${folderLabel(name)}” and its messages on ${active.email}? This may permanently remove messages from your mail provider.`,
            label: "Delete folder",
            run: async () => {
                // Account switches while the dialog is open must not redirect deletion.
                if (accountRef.current?.id !== active.id) throw new Error("The active account changed. Please reopen this confirmation.");
                await mailApi.removeFolder(active.id, name);
                if (current.current.folder === name) chooseFolder(DEFAULT_FOLDER);
                await refreshFolderList(active, current.current.revision);
            },
        });
    }
    async function confirmPending() {
        if (!confirmation || confirmBusy) return;
        setConfirmBusy(true);
        try {
            await confirmation.run();
            setConfirmation(null);
        } catch (cause) {
            setError(String(cause));
            setConfirmation(null);
        } finally {
            setConfirmBusy(false);
        }
    }

    async function messageAction(action: MessageAction, ids: number[], approved = false) {
        const active = current.current;
        const scoped = messagesRef.current.filter((row) => ids.includes(row.id) && row.accountId === active.accountId && row.folder === active.folder);
        if (!scoped.length) return;
        const accountNow = accountRef.current;
        if (!accountNow || accountNow.id !== active.accountId) return;
        const locate = (type: string, fallback: string) =>
            folders.find((f) => f.selectable && f.attributes.some((a) => a.toLowerCase() === type.toLowerCase()))?.name ||
            folders.find((f) => f.selectable && f.name.toLowerCase().includes(fallback))?.name;
        if (action === "delete" && !approved) {
            setConfirmation({
                title: `Delete ${scoped.length} message${scoped.length === 1 ? "" : "s"}?`,
                description: `Delete selected mail from ${accountNow.email}? If these messages are already in Trash, they may be permanently removed.`,
                label: "Delete messages",
                run: async () => {
                    await messageAction(action, ids, true);
                },
            });
            return;
        }
        if (action === "save") {
            if (scoped.length !== 1) {
                setError("Select exactly one message to save.");
                return;
            }
            const path = await save({
                defaultPath: `${(scoped[0].subject || "message").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80)}.eml`,
                filters: [{ name: "Email message", extensions: ["eml"] }],
            });
            if (!path) return;
            try {
                await mailApi.saveMessage(active.accountId, scoped[0].id, path);
            } catch (cause) {
                setError(String(cause));
            }
            return;
        }
        let destination: string | undefined;
        if (action === "spam") destination = locate("Junk", "spam") || locate("Junk", "junk");
        if (action === "archive") destination = locate("Archive", "archive");
        if (action.startsWith("move:")) destination = action.slice(5);
        if (["spam", "archive"].includes(action) && !destination) {
            setError(`No ${action === "spam" ? "Spam/Junk" : "Archive"} folder found on this account.`);
            return;
        }
        setLoading(true);
        const failures: string[] = [];
        for (const row of scoped) {
            if (current.current.revision !== active.revision) break;
            try {
                if (action === "delete") await mailApi.deleteMessage(active.accountId, row.folder, row.uid);
                else if (destination) await mailApi.moveMessage(active.accountId, row.folder, row.uid, destination);
                else {
                    const flag = action === "read" || action === "unread" ? "\\Seen" : "\\Flagged";
                    await mailApi.setMessageFlag(active.accountId, row.folder, row.uid, flag, action === "read" || action === "star");
                }
            } catch (cause) {
                failures.push(`${row.subject || row.uid}: ${String(cause)}`);
            }
        }
        if (current.current.revision === active.revision) {
            await loadCached(active.accountId, active.folder, query, active.revision);
            setSelection([]);
            setSelected(null);
            setLoading(false);
            if (failures.length) setError(`${failures.length} message action(s) failed: ${failures[0]}`);
        }
    }

    if (initializing)
        return (
            <>
                <div className="mail-shell flex h-full items-center justify-center">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <LoaderCircle className="size-4 animate-spin" /> Opening mail database…
                    </div>
                </div>
                <UpdateCenter updater={updater} />
            </>
        );
    if (!account)
        return (
            <main className="mail-shell flex h-full items-center justify-center p-8">
                <div className="w-full max-w-lg rounded-2xl border border-border bg-card/80 p-8 text-center shadow-2xl">
                    <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                        <MailPlus className="size-7" />
                    </div>
                    <h1 className="mt-5 text-2xl font-semibold">Connect your first mailbox</h1>
                    <p className="mx-auto mt-2 text-sm text-muted-foreground">
                        Connect to an existing IMAP and SMTP server. Connections are verified before accounts are saved.
                    </p>
                    <Button
                        className="mt-6"
                        onClick={addAccount}
                    >
                        <MailPlus /> Add account
                    </Button>
                    <div className="mt-3 flex justify-center gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSettingsOpen(true)}
                        >
                            Preferences
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void updater.checkForUpdates(true)}
                        >
                            Check for updates
                        </Button>
                    </div>
                    {error && <p className="mt-4 text-xs text-destructive">{error}</p>}
                </div>
                <AccountDialog
                    open={accountDialog}
                    onOpenChange={setAccountDialog}
                    account={editingAccount}
                    onSaved={handleSaved}
                    onDeleted={handleDeleted}
                />
                <SettingsDialog
                    open={settingsOpen}
                    onOpenChange={setSettingsOpen}
                />
                <UpdateCenter updater={updater} />
            </main>
        );

    return (
        <main className="mail-shell h-full min-h-0">
            {error && (
                <div
                    role="alert"
                    className="fixed bottom-4 left-1/2 z-50 flex max-w-xl -translate-x-1/2 items-center gap-3 rounded-lg border border-destructive/40 bg-card px-4 py-3 text-xs text-foreground shadow-2xl"
                >
                    <span className="min-w-0 flex-1">{error}</span>
                    <button
                        type="button"
                        aria-label="Dismiss error"
                        className="cursor-pointer rounded p-1 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                        onClick={() => setError(null)}
                    >
                        ×
                    </button>
                </div>
            )}
            <div className="grid h-full min-h-0 grid-cols-[220px_minmax(300px,390px)_minmax(420px,1fr)]">
                <MailSidebar
                    accounts={accounts}
                    account={account}
                    folders={folders}
                    folder={folder}
                    onAccountChange={(next) => void activateAccount(next)}
                    onManageAccounts={() => setManageOpen(true)}
                    onFolderChange={chooseFolder}
                    onCreateFolder={() => setCreateFolderOpen(true)}
                    onRemoveFolder={(name) => void removeFolder(name)}
                    onCompose={() => compose()}
                    onSettings={() => setSettingsOpen(true)}
                    onUpdates={() => void updater.checkForUpdates(true)}
                    updatesAvailable={updater.hasUpdate}
                    updatesChecking={updater.status === "checking"}
                />
                <MessageList
                    accountId={account.id}
                    folder={folder}
                    messages={messages}
                    selectedId={selected?.id}
                    selection={selection}
                    loading={loading}
                    folders={folders.filter((f) => f.selectable).map((f) => f.name)}
                    query={query}
                    onQueryChange={setSearch}
                    onSelect={(msg) => void selectMessage(msg)}
                    onSelectionChange={setSelection}
                    onAction={(action, ids) => void messageAction(action, ids)}
                    onSync={sync}
                    onLoadOlder={loadOlder}
                    canLoadOlder={hasOlderMessages && syncLimit < 1000 && !query}
                />
                <MessageView
                    account={account}
                    message={selected}
                    folders={folders}
                    onCompose={compose}
                    onChanged={refreshCurrentMessage}
                    onError={setError}
                />
            </div>
            <CreateFolderDialog
                open={createFolderOpen}
                accountEmail={account.email}
                onClose={() => setCreateFolderOpen(false)}
                onCreate={createFolder}
            />
            <ConfirmActionDialog
                open={Boolean(confirmation)}
                title={confirmation?.title ?? "Confirm"}
                description={confirmation?.description ?? ""}
                confirmLabel={confirmation?.label ?? "Confirm"}
                busy={confirmBusy}
                onClose={() => setConfirmation(null)}
                onConfirm={() => void confirmPending()}
            />
            <ManageAccountsDialog
                open={manageOpen}
                onOpenChange={setManageOpen}
                accounts={accounts}
                onAdd={addAccount}
                onEdit={editAccount}
                onRemove={(item) => void removeAccount(item)}
            />
            <AccountDialog
                open={accountDialog}
                onOpenChange={setAccountDialog}
                account={editingAccount}
                onSaved={handleSaved}
                onDeleted={handleDeleted}
            />
            <SettingsDialog
                open={settingsOpen}
                onOpenChange={setSettingsOpen}
                onAccountSettings={() => {
                    setSettingsOpen(false);
                    setManageOpen(true);
                }}
            />
            <UpdateCenter updater={updater} />
        </main>
    );
}
