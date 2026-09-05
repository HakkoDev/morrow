import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { storeComposeSeed, type ComposeSeed } from "@/components/mail/compose-window";

export async function openComposeWindow(accountId: string, seed?: ComposeSeed | null) {
  const token = crypto.randomUUID();
  const label = `compose-${token.replaceAll("-", "")}`;
  storeComposeSeed(token, seed);

  const composeWindow = new WebviewWindow(label, {
    url: `index.html?view=compose&accountId=${encodeURIComponent(accountId)}&seedKey=${encodeURIComponent(token)}`,
    title: seed?.subject ? `${seed.subject} — Morrow` : "New Message — Morrow",
    width: 900,
    height: 720,
    minWidth: 640,
    minHeight: 500,
    resizable: true,
    center: true,
    focus: true,
  });

  await Promise.race([
    new Promise<void>((resolve) => {
      void composeWindow.once("tauri://created", () => resolve());
    }),
    new Promise<void>((_, reject) => {
      void composeWindow.once<string>("tauri://error", (event) => reject(new Error(String(event.payload))));
    }),
  ]);
}
