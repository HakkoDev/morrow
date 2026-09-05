import ReactDOM from "react-dom/client";
import { ComposeWindow } from "@/components/mail/compose-window";
import { TooltipProvider } from "@/components/ui/tooltip";
import App from "./App";
import "./styles.css";

const params = new URLSearchParams(window.location.search);
const root = params.get("view") === "compose" ? <ComposeWindow /> : <App />;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <TooltipProvider delayDuration={250}>
    {root}
  </TooltipProvider>,
);
