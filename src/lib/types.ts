export type SecurityMode = "tls" | "startTls" | "plain";

export interface Account {
    id: string;
    displayName: string;
    email: string;
    imapHost: string;
    imapPort: number;
    imapSecurity: SecurityMode;
    imapUsername: string;
    smtpHost: string;
    smtpPort: number;
    smtpSecurity: SecurityMode;
    smtpUsername: string;
    sentFolder: string;
    draftsFolder: string;
    trashFolder: string;
    saveSentCopy: boolean;
    authMethod: "password" | "google" | "microsoft";
    oauthClientId: string;
}

export interface AccountInput extends Account {
    imapPassword?: string;
    smtpPassword?: string;
    oauthTicket?: string;
}

export interface Folder {
    name: string;
    delimiter?: string | null;
    attributes: string[];
    selectable: boolean;
}

export interface MessageSummary {
    id: number;
    accountId: string;
    folder: string;
    uid: number;
    messageId?: string | null;
    threadKey: string;
    subject: string;
    sender: string;
    recipients: string;
    date: number;
    preview: string;
    flags: string[];
}

export interface AttachmentInfo {
    index: number;
    name: string;
    contentType: string;
    size: number;
}

export interface MessageDetail extends MessageSummary {
    cc: string;
    bodyText: string;
    bodyHtml?: string | null;
    attachments: AttachmentInfo[];
}

export interface SendMessageInput {
    accountId: string;
    to: string;
    cc?: string;
    bcc?: string;
    subject: string;
    body: string;
    htmlBody?: string | null;
    inReplyTo?: string | null;
    references?: string | null;
    attachments: string[];
}

export interface ConnectionTestResult {
    imap: boolean;
    smtp: boolean;
}

export interface LocalDraft {
    id: string;
    accountId: string;
    to: string;
    cc: string;
    bcc: string;
    subject: string;
    body: string;
    htmlBody?: string | null;
    inReplyTo?: string | null;
    references?: string | null;
    attachments: string[];
    updatedAt: number;
}

export interface DraftSyncStatus {
    localRevision: string;
    remoteRevision: string;
    remoteHash: string;
    uidValidity: number;
    remoteUid: number;
    status: string;
    note: string;
}

export interface DraftSyncReport {
    uploaded: number;
    downloaded: number;
    conflicts: number;
    skipped: number;
}

// Foreign IMAP Drafts are read-only until the user explicitly imports a copy.
export interface ExternalDraftSummary {
    uid: number;
    uidValidity: number;
    subject: string;
    to: string;
    from: string;
}
