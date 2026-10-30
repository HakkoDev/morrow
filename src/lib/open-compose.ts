import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { type ComposeSeed, clearComposeSeed, storeComposeSeed } from "@/components/mail/compose-window";

export async function openComposeWindow(accountId: string, seed?: ComposeSeed | null, draftId?: string) {
    const token = crypto.randomUUID();
    const label = `compose-${token.replaceAll("-", "")}`;
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
