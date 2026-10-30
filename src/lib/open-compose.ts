import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { type ComposeSeed, clearComposeSeed, storeComposeSeed } from "@/components/mail/compose-window";

export async function openComposeWindow(accountId: string, seed?: ComposeSeed | null, draftId?: string) {
    const token = crypto.randomUUID();
    // Reopening a saved draft must not create two independently autosaving editors.
    const identity = draftId ? new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([accountId, draftId])))) : null;
    const label = identity
        ? `compose-draft-${Array.from(identity, (byte) => byte.toString(16).padStart(2, "0")).join("")}`
        : `compose-${token.replaceAll("-", "")}`;
    if (draftId) {
        const existing = await WebviewWindow.getByLabel(label);
        if (existing) {
            await existing.setFocus();
            return;
        }
    }
    storeComposeSeed(token, seed);

    const composeWindow = new WebviewWindow(label, {
        url: `index.html?view=compose&accountId=${encodeURIComponent(accountId)}&seedKey=${encodeURIComponent(token)}${draftId ? `&draftId=${encodeURIComponent(draftId)}` : ""}`,
        title: seed?.subject ? `${seed.subject} — Morrow` : "New Message — Morrow",
        width: 900,
        height: 720,
        minWidth: 640,
        minHeight: 500,
        resizable: true,
        center: true,
        focus: true,
    });

    try {
        await new Promise<void>((resolve, reject) => {
            void composeWindow.once("tauri://created", () => resolve());
            void composeWindow.once<string>("tauri://error", (event) => reject(new Error(String(event.payload))));
        });
    } catch (error) {
        // Never retain an unsent reply's content because window creation failed.
        clearComposeSeed(token);
        throw error;
    }
}
