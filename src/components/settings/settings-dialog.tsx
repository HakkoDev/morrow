import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { Check, Palette, RotateCcw, Search, Shield, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type AppearanceMode, type MailDensity, type Preferences, resetPreferences, updatePreferences, usePreferences } from "@/lib/preferences";
import { type ThemeId, themeIds, themePresets } from "@/lib/theme-presets";

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onAccountSettings?: () => void;
}

function PreferenceCheckbox({
    label,
    description,
    field,
    value,
}: {
    label: string;
    description: string;
    field: "showPreviews" | "markReadOnOpen" | "allowRemoteImages" | "loadOnlineFonts" | "emailDarkMode" | "desktopNotifications";
    value: boolean;
}) {
    return (
        <Label className="flex cursor-pointer items-center justify-between gap-6 rounded-lg border border-border bg-card/45 p-3 hover:bg-accent/30">
            <span className="min-w-0">
                <span className="block text-sm font-medium">{label}</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span>
            </span>
            <Switch
                checked={value}
                aria-label={label}
                onCheckedChange={(checked) => {
                    if (field !== "desktopNotifications" || !checked) {
                        updatePreferences({ [field]: checked } as Partial<Preferences>);
                        return;
                    }
                    void (async () => {
                        try {
                            const allowed = (await isPermissionGranted()) || (await requestPermission()) === "granted";
                            updatePreferences({ desktopNotifications: allowed });
                        } catch {
                            updatePreferences({ desktopNotifications: false });
                        }
                    })();
                }}
            />
        </Label>
    );
}

function ThemeCard({ id, active, mode, onSelect }: { id: ThemeId; active: boolean; mode: "light" | "dark"; onSelect: () => void }) {
    const preset = themePresets[id];
    const palette = preset[mode];
    return (
        <Button
            variant="outline"
            type="button"
            onClick={onSelect}
            aria-pressed={active}
            aria-label={`Use ${preset.label} theme`}
            className={`h-auto min-w-0 flex-col items-stretch gap-0 whitespace-normal rounded-lg border p-2 text-left transition ${active ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}
        >
            <div
                className="h-[67px] overflow-hidden rounded-md border"
                style={{ background: palette.background, borderColor: palette.border }}
            >
                <div className="flex h-full">
                    <div
                        className="w-1/4 border-r p-1"
                        style={{ background: palette.sidebar, borderColor: palette.sidebarBorder }}
                    >
                        <div
                            className="mb-1 h-1.5 w-8 rounded-full"
                            style={{ background: palette.sidebarPrimary }}
                        />
                        <div
                            className="mb-1 h-1 w-6 rounded-full opacity-70"
                            style={{ background: palette.sidebarForeground }}
                        />
                        <div
                            className="h-1 w-5 rounded-full opacity-50"
                            style={{ background: palette.sidebarForeground }}
                        />
                    </div>
                    <div className="flex flex-1 flex-col gap-1 p-2">
                        <div
                            className="h-2 w-4/5 rounded-sm"
                            style={{ background: palette.card }}
                        />
                        <div
                            className="h-2 w-3/5 rounded-sm"
                            style={{ background: palette.muted }}
                        />
                        <div
                            className="mt-auto h-2 w-10 rounded-sm"
                            style={{ background: palette.primary }}
                        />
                    </div>
                </div>
            </div>
            <div className="mt-2 flex items-center gap-1 text-xs font-medium">
                <span className="min-w-0 flex-1 truncate">{preset.label}</span>
                {active && <Check className="size-3.5 shrink-0 text-primary" />}
            </div>
        </Button>
    );
}

export function SettingsDialog({ open, onOpenChange, onAccountSettings }: Props) {
    const preferences = usePreferences();
    const [section, setSection] = useState<"appearance" | "mail" | "privacy">("appearance");
    const [search, setSearch] = useState("");
    const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
    useEffect(() => {
        const media = window.matchMedia("(prefers-color-scheme: dark)");
        const update = () => setSystemDark(media.matches);
        media.addEventListener("change", update);
        return () => media.removeEventListener("change", update);
    }, []);
    const themeMatches = useMemo(() => themeIds.filter((id) => themePresets[id].label.toLowerCase().includes(search.toLowerCase().trim())), [search]);
    const mode = preferences.appearance === "system" ? (systemDark ? "dark" : "light") : preferences.appearance;

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
        >
            <DialogContent className="flex h-[min(84vh,750px)] w-[min(95vw,930px)] max-w-none flex-col overflow-hidden p-0">
                <div className="border-b border-border px-6 pt-5 pb-4">
                    <DialogHeader className="mb-0">
                        <DialogTitle>Settings</DialogTitle>
                        <DialogDescription>Personalize Morrow on this device. Changes are applied immediately, including in compose windows.</DialogDescription>
                    </DialogHeader>
                </div>
                <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
                    <Tabs
                        value={section}
                        onValueChange={(value) => setSection(value as "appearance" | "mail" | "privacy")}
                        className="flex min-h-0 flex-1 flex-col sm:flex-row"
                    >
                        <TabsList
                            className="flex h-auto shrink-0 justify-start gap-1 rounded-none border-b border-border bg-transparent p-3 sm:w-44 sm:flex-col sm:items-stretch sm:border-r sm:border-b-0"
                            aria-label="Settings sections"
                        >
                            {(
                                [
                                    ["appearance", Palette, "Appearance"],
                                    ["mail", SlidersHorizontal, "Mail"],
                                    ["privacy", Shield, "Privacy"],
                                ] as const
                            ).map(([id, Icon, label]) => (
                                <TabsTrigger
                                    key={id}
                                    value={id}
                                    className="justify-start px-3 py-2 text-xs"
                                >
                                    <Icon className="size-4" /> {label}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
                            <TabsContent
                                value="appearance"
                                className="mt-0 space-y-6"
                            >
                                <section>
                                    <h2 className="text-sm font-semibold">Color theme</h2>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        TweakCN presets with their original colors, typography, corner radius and shadow styles. No custom tints or accents.
                                    </p>
                                    <div className="mt-4 flex flex-wrap items-center gap-2">
                                        <Label
                                            htmlFor="morrow-theme-mode"
                                            className="text-xs text-muted-foreground"
                                        >
                                            Appearance
                                        </Label>
                                        <NativeSelect
                                            id="morrow-theme-mode"
                                            value={preferences.appearance}
                                            onChange={(e) => updatePreferences({ appearance: e.target.value as AppearanceMode })}
                                            className="rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground"
                                        >
                                            <option value="dark">Dark</option>
                                            <option value="light">Light</option>
                                            <option value="system">Follow system</option>
                                        </NativeSelect>
                                        <div className="ml-auto flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-muted-foreground">
                                            <Search className="size-3.5" />
                                            <Input
                                                value={search}
                                                onChange={(e) => setSearch(e.target.value)}
                                                aria-label="Search themes"
                                                placeholder="Find a theme"
                                                className="h-9 w-28 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0 sm:w-40"
                                            />
                                        </div>
                                    </div>
                                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                                        {themeMatches.map((id) => (
                                            <ThemeCard
                                                key={id}
                                                id={id}
                                                mode={mode}
                                                active={preferences.themeId === id}
                                                onSelect={() => updatePreferences({ themeId: id })}
                                            />
                                        ))}
                                    </div>
                                    {themeMatches.length === 0 && (
                                        <p className="py-6 text-center text-xs text-muted-foreground">No themes match your search.</p>
                                    )}
                                </section>
                                <section className="space-y-3 border-t border-border pt-5">
                                    <h2 className="text-sm font-semibold">Display</h2>
                                    <div className="flex items-center justify-between gap-4">
                                        <Label
                                            htmlFor="mail-density"
                                            className="text-xs text-muted-foreground"
                                        >
                                            Message list density
                                        </Label>
                                        <NativeSelect
                                            id="mail-density"
                                            value={preferences.density}
                                            onChange={(e) => updatePreferences({ density: e.target.value as MailDensity })}
                                            className="rounded-md border border-border bg-background px-3 py-2 text-xs"
                                        >
                                            <option value="comfortable">Comfortable</option>
                                            <option value="compact">Compact</option>
                                        </NativeSelect>
                                    </div>
                                    <div className="flex items-center justify-between gap-4">
                                        <Label
                                            htmlFor="font-scale"
                                            className="text-xs text-muted-foreground"
                                        >
                                            Base font scale
                                        </Label>
                                        <NativeSelect
                                            id="font-scale"
                                            value={preferences.fontScale}
                                            onChange={(e) => updatePreferences({ fontScale: Number(e.target.value) })}
                                            className="rounded-md border border-border bg-background px-3 py-2 text-xs"
                                        >
                                            {[85, 90, 95, 100, 105, 110, 115, 120, 125].map((size) => (
                                                <option
                                                    key={size}
                                                    value={size}
                                                >
                                                    {size}%
                                                </option>
                                            ))}
                                        </NativeSelect>
                                    </div>
                                    <PreferenceCheckbox
                                        field="loadOnlineFonts"
                                        label="Download theme fonts"
                                        description="Request matching fonts from Google Fonts. Off by default to avoid external requests."
                                        value={preferences.loadOnlineFonts}
                                    />
                                </section>
                            </TabsContent>
                            <TabsContent
                                value="mail"
                                className="mt-0 space-y-4"
                            >
                                <h2 className="text-sm font-semibold">Reading mail</h2>
                                <PreferenceCheckbox
                                    field="desktopNotifications"
                                    value={preferences.desktopNotifications}
                                    label="Desktop notifications"
                                    description="Show a generic new-mail notification. Morrow never includes sender names or message text in notifications. Off until you grant permission."
                                />
                                <PreferenceCheckbox
                                    field="showPreviews"
                                    value={preferences.showPreviews}
                                    label="Show message snippets"
                                    description="Display the first lines of each message in the mail list."
                                />
                                <PreferenceCheckbox
                                    field="markReadOnOpen"
                                    value={preferences.markReadOnOpen}
                                    label="Mark messages as read when opened"
                                    description="Send the IMAP Seen flag when you select an unread message."
                                />
                                <PreferenceCheckbox
                                    field="emailDarkMode"
                                    value={preferences.emailDarkMode}
                                    label="Dark email contents"
                                    description="Try to render HTML messages using a dark background. Use the reader toggle for individual preferences."
                                />
                                <div className="rounded-lg border border-border p-4 text-xs leading-6 text-muted-foreground">
                                    INBOX uses IMAP IDLE when the server supports it, with a 60-second Rust polling fallback. Manual refresh is also available
                                    from the mailbox toolbar.
                                </div>
                                {onAccountSettings && (
                                    <Button
                                        variant="outline"
                                        onClick={() => {
                                            onOpenChange(false);
                                            onAccountSettings();
                                        }}
                                    >
                                        Manage IMAP/SMTP account
                                    </Button>
                                )}
                            </TabsContent>
                            <TabsContent
                                value="privacy"
                                className="mt-0 space-y-4"
                            >
                                <h2 className="text-sm font-semibold">Privacy</h2>
                                <PreferenceCheckbox
                                    field="allowRemoteImages"
                                    value={preferences.allowRemoteImages}
                                    label="Automatically load remote email images"
                                    description="Off by default. Enabling may reveal your IP address and that you opened an email to its sender."
                                />
                                <div className="rounded-lg border border-border bg-muted/30 p-4 text-xs leading-6 text-muted-foreground">
                                    Email HTML remains sandboxed and sanitized regardless of this setting. Passwords are stored separately in the operating
                                    system's credential vault, not in these preferences.
                                </div>
                            </TabsContent>
                        </div>
                    </Tabs>
                </div>
                <footer className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={resetPreferences}
                    >
                        <RotateCcw className="size-4" /> Restore defaults
                    </Button>
                    <Button
                        size="sm"
                        onClick={() => onOpenChange(false)}
                    >
                        Done
                    </Button>
                </footer>
            </DialogContent>
        </Dialog>
    );
}
