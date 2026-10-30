import { invoke } from "@tauri-apps/api/core";
import type {
    Account,
    AccountInput,
    ConnectionTestResult,
    DraftSyncReport,
    DraftSyncStatus,
    ExternalDraftSummary,
    Folder,
    LocalDraft,
    MessageDetail,
    MessageSummary,
    SendMessageInput,
} from "./types";

export const mailApi = {
    listAccounts: () => invoke<Account[]>("list_accounts"),
    authorizeOAuth: (account: Account) => invoke<string>("authorize_oauth", { account }),
    saveAccount: (input: AccountInput) => invoke<Account>("save_account", { input }),
    deleteAccount: (accountId: string) => invoke<void>("delete_account", { accountId }),
    testAccount: (input: AccountInput) => invoke<ConnectionTestResult>("test_account", { input }),
    listFolders: (accountId: string) => invoke<Folder[]>("list_folders", { accountId }),
    cachedFolders: (accountId: string) => invoke<Folder[]>("cached_folders", { accountId }),
    createFolder: (accountId: string, name: string) => invoke<void>("create_folder", { accountId, name }),
    removeFolder: (accountId: string, name: string) => invoke<void>("remove_folder", { accountId, name }),
    saveMessage: (accountId: string, messageId: number, path: string) => invoke<void>("save_message", { accountId, messageId, path }),
    syncFolder: (accountId: string, folder: string, limit = 100) => invoke<number>("sync_folder", { accountId, folder, limit }),
    listMessages: (accountId: string, folder: string, query = "") => invoke<MessageSummary[]>("list_messages", { accountId, folder, query }),
    unifiedInbox: () => invoke<MessageSummary[]>("unified_inbox"),
    unreadCounts: () => invoke<Record<string, number>>("unread_counts"),
    searchCached: (query: string, accountId?: string) => invoke<MessageSummary[]>("search_cached_messages", { query, accountId: accountId || null }),
    conversation: (accountId: string, threadKey: string) => invoke<MessageSummary[]>("conversation", { accountId, threadKey }),
    saveLocalDraft: (draft: LocalDraft) => invoke<void>("save_local_draft", { draft }),
    listLocalDrafts: (accountId: string) => invoke<LocalDraft[]>("list_local_drafts", { accountId }),
    deleteLocalDraft: (accountId: string, draftId: string) => invoke<void>("delete_local_draft", { accountId, draftId }),
    syncRemoteDraft: (accountId: string, draftId: string) => invoke<void>("sync_remote_draft", { accountId, draftId }),
    refreshRemoteDrafts: (accountId: string) => invoke<DraftSyncReport>("refresh_remote_drafts", { accountId }),
    listExternalDrafts: (accountId: string) => invoke<ExternalDraftSummary[]>("list_external_drafts", { accountId }),
    importExternalDraft: (accountId: string, uid: number, uidValidity: number) => invoke<LocalDraft>("import_external_draft", { accountId, uid, uidValidity }),
    resolveDraftConflict: (accountId: string, draftId: string, choice: "keepLocal" | "keepServer" | "keepLocalOffline") =>
        invoke<void>("resolve_draft_conflict", { accountId, draftId, choice }),
    draftSyncStatuses: (accountId: string) => invoke<Record<string, DraftSyncStatus>>("draft_sync_statuses", { accountId }),
    setDraftEditorActive: (accountId: string, draftId: string, editorToken: string, active: boolean) =>
        invoke<void>("set_draft_editor_active", { accountId, draftId, editorToken, active }),
    deleteRemoteDraft: (accountId: string, draftId: string) => invoke<void>("delete_remote_draft", { accountId, draftId }),
    getMessage: (accountId: string, messageId: number) => invoke<MessageDetail>("get_message", { accountId, messageId }),
    setMessageFlag: (accountId: string, folder: string, uid: number, flag: string, enabled: boolean) =>
        invoke<void>("set_message_flag", { accountId, folder, uid, flag, enabled }),
    moveMessage: (accountId: string, folder: string, uid: number, destination: string) => invoke<void>("move_message", { accountId, folder, uid, destination }),
    deleteMessage: (accountId: string, folder: string, uid: number) => invoke<void>("delete_message", { accountId, folder, uid }),
    sendMessage: (input: SendMessageInput) => invoke<void>("send_message", { input }),
    saveAttachment: (accountId: string, messageId: number, attachmentIndex: number, path: string) =>
        invoke<void>("save_attachment", { accountId, messageId, attachmentIndex, path }),
};
