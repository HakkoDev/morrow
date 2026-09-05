import { Archive, ChevronDown, FileText, Inbox, Mail, PenLine, Plus, Send, Settings, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, initials } from "@/lib/utils";
import type { Account, Folder } from "@/lib/types";

interface Props {
  accounts: Account[];
  account: Account | null;
  folders: Folder[];
  folder: string;
  onAccountChange: (account: Account) => void;
  onFolderChange: (folder: string) => void;
  onCompose: () => void;
  onAddAccount: () => void;
  onSettings: () => void;
}

const iconForFolder = (name: string) => {
  const lower = name.toLowerCase();
  if (lower === "inbox") return Inbox;
  if (lower.includes("sent")) return Send;
  if (lower.includes("draft")) return FileText;
  if (lower.includes("trash") || lower.includes("deleted")) return Trash2;
  if (lower.includes("archive")) return Archive;
  return Mail;
};

export function MailSidebar(props: Props) {
  return (
    <aside className="flex h-full min-w-0 flex-col border-r border-border bg-card/60 backdrop-blur-xl">
      <div className="flex h-14 items-center gap-2 px-3">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary/15 text-sm font-bold text-primary">M</div>
        <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">Morrow</div><div className="text-[10px] text-muted-foreground">IMAP + SMTP · auto-sync</div></div>
        <Button variant="ghost" size="icon" className="size-8" onClick={props.onSettings}><Settings /></Button>
      </div>
      <div className="px-3 pb-3"><Button className="w-full justify-start" onClick={props.onCompose}><PenLine /> Compose</Button></div>

      <div className="px-3 pb-2">
        <label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Account</label>
        <div className="mt-2 grid gap-1">
          {props.accounts.map((account) => (
            <button key={account.id} onClick={() => props.onAccountChange(account)} className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition hover:bg-accent", account.id === props.account?.id && "bg-accent")}> 
              <div className="flex size-8 items-center justify-center rounded-full bg-secondary text-xs font-semibold">{initials(account.displayName || account.email)}</div>
              <div className="min-w-0 flex-1"><div className="truncate text-xs font-medium">{account.displayName || account.email}</div><div className="truncate text-[10px] text-muted-foreground">{account.email}</div></div>
              {account.id === props.account?.id && <ChevronDown className="size-3.5 text-muted-foreground" />}
            </button>
          ))}
          <button onClick={props.onAddAccount} className="flex items-center gap-2 rounded-md px-2 py-2 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"><Plus className="size-4" /> Add account</button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-3">
        <div className="pb-4">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Folders</div>
          <div className="grid gap-0.5">
            {props.folders.filter((item) => item.selectable).map((item) => {
              const Icon = iconForFolder(item.name);
              return <button key={item.name} onClick={() => props.onFolderChange(item.name)} className={cn("flex items-center gap-2 rounded-md px-2 py-2 text-xs transition hover:bg-accent", props.folder === item.name ? "bg-accent font-medium text-foreground" : "text-muted-foreground")}><Icon className="size-4" /><span className="truncate">{item.name}</span></button>;
            })}
          </div>
        </div>
      </ScrollArea>
    </aside>
  );
}
