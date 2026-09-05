import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { LoaderCircle, MailPlus } from "lucide-react";
import { AccountDialog } from "@/components/mail/account-dialog";
import type { ComposeSeed } from "@/components/mail/compose-window";
import { MailSidebar } from "@/components/mail/mail-sidebar";
import { MessageList } from "@/components/mail/message-list";
import { MessageView } from "@/components/mail/message-view";
import { Button } from "@/components/ui/button";
import { mailApi } from "@/lib/mail-api";
import { openComposeWindow } from "@/lib/open-compose";
import type { Account, Folder, MessageDetail, MessageSummary } from "@/lib/types";

export default function App() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folder, setFolder] = useState("INBOX");
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [selected, setSelected] = useState<MessageDetail | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncLimit, setSyncLimit] = useState(100);
  const [initializing, setInitializing] = useState(true);
  const [accountDialog, setAccountDialog] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshAccounts = useCallback(async (preferredId?: string) => {
    const rows = await mailApi.listAccounts();
    setAccounts(rows);
    const next = rows.find((item) => item.id === preferredId) || rows[0] || null;
    setAccount(next);
    return next;
  }, []);

  const loadFolders = useCallback(async (active: Account) => {
    setLoading(true);
    try {
      const rows = await mailApi.listFolders(active.id);
      setFolders(rows);
      const inbox = rows.find((item) => item.name.toUpperCase() === "INBOX" && item.selectable)?.name;
      setFolder((current) => rows.some((item) => item.name === current && item.selectable) ? current : inbox || rows.find((item) => item.selectable)?.name || "INBOX");
      return rows;
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMessages = useCallback(async (active: Account, activeFolder: string, search = query) => {
    try {
      const rows = await mailApi.listMessages(active.id, activeFolder, search);
      setMessages(rows);
      if (selected && !rows.some((item) => item.id === selected.id)) setSelected(null);
    } catch (e) {
      setError(String(e));
    }
  }, [query, selected]);

  useEffect(() => {
    void (async () => {
      try {
        const active = await refreshAccounts();
        if (active) {
          const rows = await loadFolders(active);
          const inbox = rows.find((item) => item.name.toUpperCase() === "INBOX" && item.selectable)?.name || "INBOX";
          await mailApi.syncFolder(active.id, inbox, 100).catch(() => undefined);
          await loadMessages(active, inbox, "");
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setInitializing(false);
      }
    })();
  }, [refreshAccounts, loadFolders]);

  useEffect(() => {
    if (account) void loadMessages(account, folder, query);
  }, [account?.id, folder, query]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listen<{ accountId: string; folder: string }>("mail:synced", (event) => {
      if (disposed || !account || event.payload.accountId !== account.id) return;
      if (event.payload.folder.toUpperCase() === folder.toUpperCase()) void loadMessages(account, folder, query);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [account?.id, folder, query, loadMessages]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listen<{ accountId: string }>("mail:sent", (event) => {
      if (disposed || !account || event.payload.accountId !== account.id) return;
      if (folder === account.sentFolder) void sync();
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [account?.id, folder, account?.sentFolder]);

  async function chooseAccount(next: Account) {
    setAccount(next);
    setSelected(null);
    setFolders([]);
    setFolder("INBOX");
    setSyncLimit(100);
    setError(null);
    try {
      const rows = await loadFolders(next);
      const inbox = rows.find((item) => item.name.toUpperCase() === "INBOX" && item.selectable)?.name || "INBOX";
      setFolder(inbox);
      await mailApi.syncFolder(next.id, inbox, 100).catch(() => undefined);
      await loadMessages(next, inbox, "");
    } catch (e) { setError(String(e)); }
  }

  async function sync() {
    if (!account || !folder) return;
    setLoading(true);
    setError(null);
    try {
      await mailApi.syncFolder(account.id, folder, syncLimit);
      await loadMessages(account, folder, query);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function chooseFolder(next: string) {
    setFolder(next);
    setSelected(null);
    setSyncLimit(100);
    setError(null);
    if (!account) return;
    setLoading(true);
    try {
      await mailApi.syncFolder(account.id, next, 100);
      await loadMessages(account, next, query);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadOlder() {
    if (!account || !folder || syncLimit >= 1000) return;
    const nextLimit = Math.min(syncLimit + 100, 1000);
    setLoading(true);
    setError(null);
    try {
      await mailApi.syncFolder(account.id, folder, nextLimit);
      setSyncLimit(nextLimit);
      await loadMessages(account, folder, query);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function selectMessage(summary: MessageSummary) {
    setError(null);
    try {
      const detail = await mailApi.getMessage(summary.id);
      setSelected(detail);
      const unread = !detail.flags.includes("Seen") && !detail.flags.includes("\\Seen");
      if (unread && account) {
        await mailApi.setMessageFlag(account.id, detail.folder, detail.uid, "\\Seen", true);
        setSelected({ ...detail, flags: [...detail.flags, "Seen"] });
        await loadMessages(account, folder, query);
      }
    } catch (e) { setError(String(e)); }
  }

  function compose(seed?: ComposeSeed) {
    if (!account) return;
    void openComposeWindow(account.id, seed || null).catch((e) => setError(String(e)));
  }

  async function handleSaved(saved: Account) {
    const active = await refreshAccounts(saved.id);
    if (active) {
      const rows = await loadFolders(active);
      const inbox = rows.find((item) => item.name.toUpperCase() === "INBOX" && item.selectable)?.name || "INBOX";
      setFolder(inbox);
      setSelected(null);
      setSyncLimit(100);
      await mailApi.syncFolder(active.id, inbox, 100).catch(() => undefined);
      await loadMessages(active, inbox, "");
    }
  }

  async function refreshCurrentMessage() {
    if (!account) return;
    const oldId = selected?.id;
    await loadMessages(account, folder, query);
    if (oldId) {
      const rows = await mailApi.listMessages(account.id, folder, query);
      const stillThere = rows.find((row) => row.id === oldId);
      if (stillThere) setSelected(await mailApi.getMessage(oldId));
      else setSelected(null);
    }
  }

  async function handleDeleted() {
    setSelected(null);
    setFolders([]);
    setMessages([]);
    const next = await refreshAccounts();
    if (next) await loadFolders(next);
  }

  if (initializing) {
    return <div className="mail-shell flex h-full items-center justify-center"><div className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> Opening mail database…</div></div>;
  }

  if (!account) {
    return (
      <main className="mail-shell flex h-full items-center justify-center p-8">
        <div className="w-full max-w-lg rounded-2xl border border-border bg-card/80 p-8 text-center shadow-2xl backdrop-blur-xl">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/15 text-primary"><MailPlus className="size-7" /></div>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">Connect your first mailbox</h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">This desktop client talks directly to your existing IMAP and SMTP servers. It does not host or relay mail itself.</p>
          <Button className="mt-6" onClick={() => { setEditingAccount(null); setAccountDialog(true); }}><MailPlus /> Add IMAP/SMTP account</Button>
          {error && <p className="mt-4 text-xs text-red-300">{error}</p>}
        </div>
        <AccountDialog open={accountDialog} onOpenChange={setAccountDialog} account={editingAccount} onSaved={handleSaved} onDeleted={handleDeleted} />
      </main>
    );
  }

  return (
    <main className="mail-shell h-full min-h-0">
      {error && <div className="fixed bottom-4 left-1/2 z-50 flex max-w-xl -translate-x-1/2 items-center gap-3 rounded-lg border border-red-500/30 bg-red-950/90 px-4 py-3 text-xs text-red-100 shadow-2xl"><span className="min-w-0 flex-1">{error}</span><button onClick={() => setError(null)}>×</button></div>}
      <div className="grid h-full min-h-0 grid-cols-[220px_minmax(300px,390px)_minmax(420px,1fr)]">
        <MailSidebar accounts={accounts} account={account} folders={folders} folder={folder} onAccountChange={chooseAccount} onFolderChange={(next) => void chooseFolder(next)} onCompose={() => compose()} onAddAccount={() => { setEditingAccount(null); setAccountDialog(true); }} onSettings={() => { setEditingAccount(account); setAccountDialog(true); }} />
        <MessageList folder={folder} messages={messages} selectedId={selected?.id} loading={loading} query={query} onQueryChange={setQuery} onSelect={selectMessage} onSync={sync} onLoadOlder={loadOlder} canLoadOlder={syncLimit < 1000} />
        <MessageView account={account} message={selected} folders={folders} onCompose={compose} onChanged={refreshCurrentMessage} onError={setError} />
      </div>
      <AccountDialog open={accountDialog} onOpenChange={setAccountDialog} account={editingAccount} onSaved={handleSaved} onDeleted={handleDeleted} />
    </main>
  );
}
