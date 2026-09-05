import { useEffect, useMemo, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { Archive, Download, ExternalLink, Forward, ImageOff, MailOpen, Reply, ReplyAll, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { mailApi } from "@/lib/mail-api";
import { sanitizedEmailDocument } from "@/lib/html";
import { initials } from "@/lib/utils";
import type { Account, Folder, MessageDetail } from "@/lib/types";
import type { ComposeSeed } from "./compose-window";

interface Props {
  account: Account | null;
  message: MessageDetail | null;
  folders: Folder[];
  onCompose: (seed: ComposeSeed) => void;
  onChanged: () => void | Promise<void>;
  onError: (message: string) => void;
}

export function MessageView({ account, message, folders, onCompose, onChanged, onError }: Props) {
  const [allowRemoteImages, setAllowRemoteImages] = useState(false);
  const [busy, setBusy] = useState(false);

  const html = useMemo(() => message?.bodyHtml ? sanitizedEmailDocument(message.bodyHtml, allowRemoteImages) : null, [message?.bodyHtml, allowRemoteImages]);
  const archiveDestination = useMemo(() => folders.find((item) => item.selectable && item.attributes.some((value) => value === "Archive"))?.name
    || folders.find((item) => item.selectable && item.name.toLowerCase().includes("archive"))?.name
    || null, [folders]);

  useEffect(() => {
    setAllowRemoteImages(false);
  }, [message?.id]);

  if (!message) {
    return <section className="flex h-full items-center justify-center bg-background/40 p-8 text-center"><div><MailOpen className="mx-auto mb-3 size-10 text-muted-foreground/40" /><h2 className="text-sm font-medium">Select a message</h2><p className="mt-1 max-w-sm text-xs text-muted-foreground">Choose an email from the message list to read it here.</p></div></section>;
  }

  // Keep a stable, non-null reference for async handlers. Props can change between renders,
  // so TypeScript intentionally does not preserve narrowing of `message` inside nested functions.
  const currentMessage = message;
  const replySubject = currentMessage.subject.toLowerCase().startsWith("re:") ? currentMessage.subject : `Re: ${currentMessage.subject}`;
  const sentAt = currentMessage.date ? new Date(currentMessage.date * 1000).toLocaleString() : "an unknown date";
  const quote = `\n\n\nOn ${sentAt}, ${currentMessage.sender} wrote:\n${currentMessage.bodyText.split("\n").map((line) => `> ${line}`).join("\n")}`;

  async function toggleStar() {
    if (!account) return;
    const starred = currentMessage.flags.includes("Flagged") || currentMessage.flags.includes("\\Flagged");
    setBusy(true);
    try {
      await mailApi.setMessageFlag(account.id, currentMessage.folder, currentMessage.uid, "\\Flagged", !starred);
      await onChanged();
    } catch (error) {
      onError(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!account) return;
    setBusy(true);
    try {
      await mailApi.deleteMessage(account.id, currentMessage.folder, currentMessage.uid);
      await onChanged();
    } catch (error) {
      onError(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!account) return;
    if (!archiveDestination) return;
    setBusy(true);
    try {
      await mailApi.moveMessage(account.id, currentMessage.folder, currentMessage.uid, archiveDestination);
      await onChanged();
    } catch (error) {
      onError(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function downloadAttachment(index: number, name: string) {
    try {
      const path = await save({ defaultPath: name });
      if (path) await mailApi.saveAttachment(currentMessage.id, index, path);
    } catch (error) {
      onError(String(error));
    }
  }

  const starred = currentMessage.flags.includes("Flagged") || currentMessage.flags.includes("\\Flagged");

  return (
    <section className="flex h-full min-w-0 flex-col bg-background/45">
      <div className="flex h-14 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-8" onClick={() => onCompose({ to: currentMessage.sender, subject: replySubject, body: quote })}><Reply /></Button>
          <Button variant="ghost" size="icon" className="size-8" onClick={() => onCompose({ to: currentMessage.sender, cc: currentMessage.recipients, subject: replySubject, body: quote })}><ReplyAll /></Button>
          <Button variant="ghost" size="icon" className="size-8" onClick={() => onCompose({ subject: `Fwd: ${currentMessage.subject}`, body: `\n\n---------- Forwarded message ----------\nFrom: ${currentMessage.sender}\nTo: ${currentMessage.recipients}\nSubject: ${currentMessage.subject}\n\n${currentMessage.bodyText}` })}><Forward /></Button>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-8" onClick={toggleStar} disabled={busy}><Star className={starred ? "fill-current text-primary" : ""} /></Button>
          <Button variant="ghost" size="icon" className="size-8" onClick={archive} disabled={busy || !archiveDestination} title={archiveDestination ? `Archive to ${archiveDestination}` : "No Archive folder found"}><Archive /></Button>
          <Button variant="ghost" size="icon" className="size-8 text-red-300 hover:text-red-200" onClick={remove} disabled={busy}><Trash2 /></Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <article className="mx-auto max-w-4xl p-7">
          <h1 className="text-xl font-semibold leading-tight tracking-tight">{currentMessage.subject || "(no subject)"}</h1>
          <div className="mt-5 flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">{initials(currentMessage.sender)}</div>
            <div className="min-w-0 flex-1"><div className="text-sm font-medium">{currentMessage.sender || "Unknown sender"}</div><div className="mt-0.5 text-xs text-muted-foreground">to {currentMessage.recipients || "me"}{currentMessage.cc ? ` · cc ${currentMessage.cc}` : ""}</div></div>
            <div className="shrink-0 text-xs text-muted-foreground">{currentMessage.date ? new Date(currentMessage.date * 1000).toLocaleString() : ""}</div>
          </div>

          {currentMessage.bodyHtml && !allowRemoteImages && <button onClick={() => setAllowRemoteImages(true)} className="mt-5 flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground hover:text-foreground"><ImageOff className="size-4" /> Remote images are blocked for privacy. Click to load them.</button>}

          <div className="message-html mt-6 overflow-hidden rounded-lg border border-border/70 bg-white">
            {html ? <iframe title="Email body" sandbox="allow-popups allow-popups-to-escape-sandbox" className="h-[620px] w-full border-0" srcDoc={html} /> : <pre className="min-h-48 whitespace-pre-wrap break-words p-6 font-sans text-sm leading-6 text-neutral-900">{currentMessage.bodyText || "This message has no readable text body."}</pre>}
          </div>

          {currentMessage.attachments.length > 0 && <div className="mt-6"><h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Attachments</h2><div className="mt-2 grid gap-2 sm:grid-cols-2">{currentMessage.attachments.map((attachment) => <button key={attachment.index} onClick={() => downloadAttachment(attachment.index, attachment.name)} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition hover:bg-accent"><div className="flex size-9 items-center justify-center rounded-md bg-secondary"><Download className="size-4" /></div><div className="min-w-0 flex-1"><div className="truncate text-xs font-medium">{attachment.name}</div><div className="mt-0.5 text-[10px] text-muted-foreground">{attachment.contentType} · {Math.max(1, Math.round(attachment.size / 1024))} KB</div></div><ExternalLink className="size-3.5 text-muted-foreground" /></button>)}</div></div>}
        </article>
      </ScrollArea>
    </section>
  );
}
