import ReactDOM from "react-dom/client";
import { ComposeWindow } from "@/components/mail/compose-window";
import { DesktopNotifications } from "@/components/mail/desktop-notifications";
import { PreferencesController } from "@/components/settings/preferences-controller";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getPreferences } from "@/lib/preferences";
import { applyPreferences } from "@/lib/theme";
import App from "./App";
import "./styles.css";

const params = new URLSearchParams(window.location.search);
const root = params.get("view") === "compose" ? <ComposeWindow /> : <App />;

applyPreferences(getPreferences());

const container = document.getElementById("root");
if (!container) {
    throw new Error("Morrow could not initialize: missing root element.");
}

ReactDOM.createRoot(container).render(
    <TooltipProvider delayDuration={250}>
        <PreferencesController />
        {params.get("view") !== "compose" && <DesktopNotifications />}
        {root}
    </TooltipProvider>,
);
