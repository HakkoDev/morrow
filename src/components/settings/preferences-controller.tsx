import { useEffect } from "react";
import { startPreferencesBridge, usePreferences } from "@/lib/preferences";
import { applyPreferences } from "@/lib/theme";

export function PreferencesController() {
    const preferences = usePreferences();
    useEffect(() => startPreferencesBridge(), []);
    useEffect(() => {
        applyPreferences(preferences);
    }, [preferences]);
    useEffect(() => {
        const media = window.matchMedia("(prefers-color-scheme: dark)");
        const update = () => applyPreferences(preferences);
        media.addEventListener("change", update);
        return () => media.removeEventListener("change", update);
    }, [preferences]);
    return null;
}
