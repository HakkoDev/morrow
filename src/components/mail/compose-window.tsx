import { useEffect, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { FilePlus2, LoaderCircle, Paperclip, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { mailApi } from "@/lib/mail-api";
import type { Account } from "@/lib/types";

export interface ComposeSeed {
  to?: string;
  cc?: string;
  subject?: string;
  body?: string;
}

const SEED_PREFIX = "mail-compose-seed:";

function readSeed(key: string | null): ComposeSeed {
  if (!key) return {};
  const storageKey = `${SEED_PREFIX}${key}`;
  try {
    const raw = window.localStorage.getItem(storageKey);
    window.localStorage.removeItem(storageKey);
    return raw ? JSON.parse(raw) as ComposeSeed : {};
  } catch {
    window.localStorage.removeItem(storageKey);
    return {};
  }
}

export function storeComposeSeed(key: string, seed?: ComposeSeed | null) {
  window.localStorage.setItem(`${SEED_PREFIX}${key}`, JSON.stringify(seed ?? {}));
}

export function ComposeWindow() {
  const params = new URLSearchParams(window.location.search);
  const accountId = params.get("accountId") || "";
  const seedKey = params.get("seedKey");

  const [account, setAccount] = useState<Account | null>(null);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const seed = readSeed(seedKey);
    setTo(seed.to || "");
    setCc(seed.cc || "");
    setSubject(seed.subject || "");
    setBody(seed.body || "");

    void (async () => {
      try {
        const accounts = await mailApi.listAccounts();
        const active = accounts.find((item) => item.id === accountId) || null;
        if (!active) throw new Error("The sending account could not be found.");
        setAccount(active);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [accountId, seedKey]);

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
      await mailApi.sendMessage({
        accountId: account.id,
        to,
        cc,
        bcc,
        subject,
        body,
        attachments,
      });
      await emit("mail:sent", { accountId: account.id });
      await getCurrentWindow().close();
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
        <Button variant="ghost" size="icon" className="size-8" onClick={() => void getCurrentWindow().close()} disabled={busy} title="Close composer">
          <X />
        </Button>
      </header>

      <div className="grid shrink-0 grid-cols-[72px_1fr] items-center border-b border-border px-5 py-2">
        <span className="text-xs text-muted-foreground">To</span>
        <Input autoFocus className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" />
      </div>
      <div className="grid shrink-0 grid-cols-[72px_1fr] items-center border-b border-border px-5 py-2">
        <span className="text-xs text-muted-foreground">Cc / Bcc</span>
        <div className="grid grid-cols-2 gap-3">
          <Input className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Cc" />
          <Input className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0" value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="Bcc" />
        </div>
      </div>
      <div className="grid shrink-0 grid-cols-[72px_1fr] items-center border-b border-border px-5 py-2">
        <span className="text-xs text-muted-foreground">Subject</span>
        <Input className="border-0 bg-transparent px-0 font-medium shadow-none focus-visible:ring-0" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
      </div>

      <Textarea className="min-h-0 flex-1 resize-none rounded-none border-0 p-5 shadow-none focus-visible:ring-0" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your message…" />

      {attachments.length > 0 && (
        <div className="flex shrink-0 flex-wrap gap-2 border-t border-border px-5 py-3">
          {attachments.map((path) => (
            <div key={path} className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs">
              <FilePlus2 className="size-3.5" />
              <span className="max-w-56 truncate">{path.split(/[\\/]/).pop()}</span>
              <button type="button" onClick={() => setAttachments((items) => items.filter((item) => item !== path))} aria-label="Remove attachment">
                <X className="size-3.5 text-muted-foreground" />
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <div className="mx-5 mb-3 shrink-0 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-red-200">{error}</div>}

      <footer className="flex shrink-0 items-center justify-between border-t border-border bg-muted/20 px-5 py-3">
        <Button variant="ghost" onClick={() => void chooseAttachments()} disabled={busy}><Paperclip /> Attach</Button>
        <Button onClick={() => void send()} disabled={busy || !account || !to.trim()}>{busy ? <LoaderCircle className="animate-spin" /> : <Send />} Send</Button>
      </footer>
    </main>
  );
}
