import { invoke } from "@tauri-apps/api/core";
import type { Account, AccountInput, ConnectionTestResult, Folder, MessageDetail, MessageSummary, SendMessageInput } from "./types";

export const mailApi = {
    listAccounts: () => invoke<Account[]>("list_accounts"),
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
    getMessage: (accountId: string, messageId: number) => invoke<MessageDetail>("get_message", { accountId, messageId }),
    setMessageFlag: (accountId: string, folder: string, uid: number, flag: string, enabled: boolean) =>
        invoke<void>("set_message_flag", { accountId, folder, uid, flag, enabled }),
    moveMessage: (accountId: string, folder: string, uid: number, destination: string) => invoke<void>("move_message", { accountId, folder, uid, destination }),
    deleteMessage: (accountId: string, folder: string, uid: number) => invoke<void>("delete_message", { accountId, folder, uid }),
    sendMessage: (input: SendMessageInput) => invoke<void>("send_message", { input }),
    saveAttachment: (accountId: string, messageId: number, attachmentIndex: number, path: string) =>
        invoke<void>("save_attachment", { accountId, messageId, attachmentIndex, path }),
};
