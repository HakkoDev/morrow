import { LoaderCircle, RefreshCw, Search, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, formatDate, initials } from "@/lib/utils";
import type { MessageSummary } from "@/lib/types";

interface Props {
  folder: string;
  messages: MessageSummary[];
  selectedId?: number | null;
  loading: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (message: MessageSummary) => void;
  onSync: () => void;
  onLoadOlder: () => void;
  canLoadOlder: boolean;
}

export function MessageList({ folder, messages, selectedId, loading, query, onQueryChange, onSelect, onSync, onLoadOlder, canLoadOlder }: Props) {
  return (
    <section className="flex h-full min-w-0 flex-col border-r border-border bg-background/70">
      <div className="flex h-14 items-center justify-between border-b border-border px-4">
        <div className="min-w-0"><h1 className="truncate text-sm font-semibold">{folder || "Mailbox"}</h1><p className="text-[10px] text-muted-foreground">{messages.length} cached messages</p></div>
        <Button variant="ghost" size="icon" className="size-8" onClick={onSync} disabled={loading}>{loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}</Button>
      </div>
      <div className="border-b border-border p-3">
        <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input className="h-8 pl-8 text-xs" value={query} onChange={(e) => onQueryChange(e.target.value)} placeholder="Search cached mail" /></div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {messages.length === 0 && !loading ? (
          <div className="flex h-40 items-center justify-center px-6 text-center text-xs text-muted-foreground">No mail cached here yet. Sync the folder to fetch messages from IMAP.</div>
        ) : (
          <div>
            <div className="divide-y divide-border/70">
            {messages.map((message) => {
              const unread = !message.flags.includes("Seen") && !message.flags.includes("\\Seen");
              const starred = message.flags.includes("Flagged") || message.flags.includes("\\Flagged");
              return (
                <button key={message.id} onClick={() => onSelect(message)} className={cn("grid w-full grid-cols-[38px_1fr] gap-2 px-3 py-3 text-left transition hover:bg-accent/60", selectedId === message.id && "bg-accent", unread && "bg-primary/[0.045]")}> 
                  <div className="flex size-8 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold">{initials(message.sender)}</div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2"><span className={cn("min-w-0 flex-1 truncate text-xs", unread ? "font-semibold text-foreground" : "font-medium")}>{message.sender || "Unknown sender"}</span>{starred && <Star className="size-3 fill-current text-primary" />}<span className="shrink-0 text-[10px] text-muted-foreground">{formatDate(message.date)}</span></div>
                    <div className={cn("mt-0.5 truncate text-xs", unread ? "font-semibold" : "text-foreground/85")}>{message.subject || "(no subject)"}</div>
                    <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{message.preview}</div>
                  </div>
                </button>
              );
            })}
            </div>
            {canLoadOlder && <div className="border-t border-border p-3"><Button variant="outline" size="sm" className="w-full" onClick={onLoadOlder} disabled={loading}>{loading ? <LoaderCircle className="animate-spin" /> : null} Load 100 older messages</Button></div>}
          </div>
        )}
      </ScrollArea>
    </section>
  );
}
