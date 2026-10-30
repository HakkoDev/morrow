/** Presentation-only names. Always pass the original IMAP mailbox path to the server. */
export function folderLabel(name: string, delimiter?: string | null): string {
    if (!name) return "Mailbox";
    const separator = delimiter && name.includes(delimiter) ? delimiter : name.includes("/") ? "/" : undefined;
    return (separator ? name.split(separator) : [name]).map((part) => (part.toUpperCase() === "INBOX" ? "Inbox" : part)).join(" / ");
}
