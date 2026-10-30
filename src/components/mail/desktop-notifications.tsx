import { listen } from "@tauri-apps/api/event";
import { isPermissionGranted, sendNotification } from "@tauri-apps/plugin-notification";
import { useEffect } from "react";
import { getPreferences } from "@/lib/preferences";

interface NewMailNotice {
    accountId: string;
    count: number;
}

export async function notifyNewMail(payload: NewMailNotice, disposed: () => boolean) {
    const enabled = () => !disposed() && getPreferences().desktopNotifications && !getPreferences().mutedAccounts.includes(payload.accountId);
    if (!enabled() || !Number.isFinite(payload.count) || payload.count < 1) return;
    try {
        if (!(await isPermissionGranted()) || !enabled()) return;
        const count = Math.min(100, Math.floor(payload.count));
        sendNotification({ title: "Morrow", body: count === 1 ? "You have new mail." : `You have ${count} new messages.` });
    } catch {
        // Permission and native delivery failures must not interrupt mailbox sync.
    }
}

// Deliberately never expose the sender, subject or message content on a
// potentially locked desktop. Notification permission is requested by the
// user in Settings, never at startup or in the background listener.
export function DesktopNotifications() {
    useEffect(() => {
        let disposed = false;
        let unlisten: (() => void) | undefined;
        void listen<NewMailNotice>("mail:new", ({ payload }) => {
            void notifyNewMail(payload, () => disposed);
        })
            .then((fn) => {
                if (disposed) fn();
                else unlisten = fn;
            })
            .catch(() => undefined);
        return () => {
            disposed = true;
            unlisten?.();
        };
    }, []);
    return null;
}
