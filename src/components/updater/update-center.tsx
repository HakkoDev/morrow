import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { ArrowDownToLine, CheckCircle2, LoaderCircle, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Status = "unconfigured" | "idle" | "checking" | "current" | "available" | "installing" | "installed" | "error";
type UpdateConfiguration = { configured: boolean };
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function useMorrowUpdater() {
    const [open, setOpen] = useState(false);
    const [dismissed, setDismissed] = useState(false);
    const [status, setStatus] = useState<Status>("idle");
    const [error, setError] = useState("");
    const [version, setVersion] = useState("");
    const [releaseNotes, setReleaseNotes] = useState("");
    const [progress, setProgress] = useState<number | null>(null);
    const configuredRef = useRef(false);
    const updateRef = useRef<Update | null>(null);
    const checkingRef = useRef(false);
    const installingRef = useRef(false);
    const aliveRef = useRef(true);

    const checkForUpdates = useCallback(async (manual = false) => {
        if (manual) setOpen(true);
        if (checkingRef.current || installingRef.current) return;
        if (!configuredRef.current) {
            setStatus("unconfigured");
            return;
        }
        checkingRef.current = true;
        setError("");
        setStatus("checking");
        try {
            // Every check gets a fresh resource; never keep stale update metadata.
            const previous = updateRef.current;
            updateRef.current = null;
            if (previous) await previous.close();
            const found = await check({ timeout: 15000 });
            if (!aliveRef.current) {
                if (found) await found.close();
                return;
            }
            if (found) {
                updateRef.current = found;
                setVersion(found.version);
                setReleaseNotes(found.body ?? "");
                setDismissed(false);
                setStatus("available");
            } else {
                setVersion("");
                setReleaseNotes("");
                setStatus("current");
            }
        } catch (cause) {
            if (!aliveRef.current) return;
            setError(String(cause));
            setStatus("error");
        } finally {
            checkingRef.current = false;
        }
    }, []);

    useEffect(() => {
        aliveRef.current = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let interval: ReturnType<typeof setInterval> | undefined;
        void (async () => {
            try {
                const config = await invoke<UpdateConfiguration>("updater_configuration");
                if (!aliveRef.current) return;
                configuredRef.current = config.configured;
                if (!config.configured) {
                    setStatus("unconfigured");
                    return;
                }
                // Don't contend with first mailbox sync at startup.
                timer = setTimeout(() => void checkForUpdates(false), 5000);
                interval = setInterval(() => void checkForUpdates(false), CHECK_INTERVAL_MS);
            } catch (cause) {
                if (!aliveRef.current) return;
                setError(String(cause));
                setStatus("error");
            }
        })();
        return () => {
            aliveRef.current = false;
            if (timer) clearTimeout(timer);
            if (interval) clearInterval(interval);
            if (updateRef.current && !installingRef.current) void updateRef.current.close();
            updateRef.current = null;
        };
    }, [checkForUpdates]);

    const installUpdate = useCallback(async () => {
        const update = updateRef.current;
        if (!update || installingRef.current) return;
        installingRef.current = true;
        setStatus("installing");
        setProgress(null);
        setError("");
        let downloaded = 0;
        let total = 0;
        try {
            // Tauri verifies the release artifact using the embedded signing key.
            await update.downloadAndInstall((event) => {
                if (event.event === "Started") {
                    total = event.data.contentLength ?? 0;
                    downloaded = 0;
                    setProgress(total > 0 ? 0 : null);
                } else if (event.event === "Progress") {
                    downloaded += event.data.chunkLength;
                    if (total > 0) setProgress(Math.min(100, Math.round((downloaded / total) * 100)));
                } else if (event.event === "Finished") {
                    setProgress(100);
                }
            });
            // On Windows, the native updater quits Morrow and restarts it via NSIS.
            // macOS/Linux return here and need an explicit relaunch.
            setStatus("installed");
            await relaunch();
        } catch (cause) {
            setError(String(cause));
            setStatus("error");
        } finally {
            installingRef.current = false;
        }
    }, []);

    return {
        open,
        setOpen,
        dismissed,
        setDismissed,
        status,
        error,
        version,
        releaseNotes,
        progress,
        checkForUpdates,
        installUpdate,
        hasUpdate: status === "available" && !dismissed,
        busy: status === "checking" || status === "installing",
    };
}

export type MorrowUpdater = ReturnType<typeof useMorrowUpdater>;

export function UpdateCenter({ updater }: { updater: MorrowUpdater }) {
    const { status, open, setOpen, version, releaseNotes, error, progress, dismissed, setDismissed } = updater;
    return (
        <>
            {status === "available" && !dismissed && !open && (
                <div
                    role="status"
                    className="fixed bottom-5 right-5 z-40 w-[min(350px,calc(100vw-40px))] rounded-xl border border-primary/30 bg-card p-4 shadow-2xl"
                >
                    <div className="flex items-start gap-3">
                        <div className="rounded-lg bg-primary/15 p-2 text-primary">
                            <ArrowDownToLine className="size-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold">Morrow {version} is available</p>
                            <p className="mt-1 text-xs text-muted-foreground">A signed update is ready to install.</p>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            className="text-muted-foreground"
                            onClick={() => setDismissed(true)}
                            aria-label="Dismiss update notification"
                        >
                            <X className="size-4" />
                        </Button>
                    </div>
                    <Button
                        className="mt-3 w-full"
                        size="sm"
                        onClick={() => setOpen(true)}
                    >
                        View update
                    </Button>
                </div>
            )}
            <Dialog
                open={open}
                onOpenChange={(next) => {
                    if (status !== "installing") setOpen(next);
                }}
            >
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Software updates</DialogTitle>
                        <DialogDescription>Morrow checks GitHub Releases for newer signed versions when the app opens and every six hours.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 text-sm">
                        {status === "checking" && (
                            <p className="flex items-center gap-2 text-muted-foreground">
                                <LoaderCircle className="size-4 animate-spin" /> Checking GitHub Releases…
                            </p>
                        )}
                        {status === "unconfigured" && (
                            <p className="text-muted-foreground">
                                Updates are not enabled in this build. A release must be signed and configured with a GitHub repository and public key. See{" "}
                                <code>UPDATER_SETUP.md</code>.
                            </p>
                        )}
                        {status === "current" && (
                            <p className="flex items-center gap-2 text-muted-foreground">
                                <CheckCircle2 className="size-4 text-primary" /> Morrow is up to date.
                            </p>
                        )}
                        {(status === "available" || status === "installing" || status === "installed") && (
                            <div className="space-y-3">
                                <p className="flex items-center gap-2">
                                    <ShieldCheck className="size-4 text-primary" /> <strong>Update {version}</strong>
                                </p>
                                {releaseNotes && (
                                    <div className="max-h-44 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">
                                        {releaseNotes}
                                    </div>
                                )}
                                {status === "installing" && (
                                    <div className="space-y-2">
                                        <p className="text-muted-foreground">Downloading and installing… {progress === null ? "" : `${progress}%`}</p>
                                        <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                                            <div
                                                className="h-full bg-primary transition-all"
                                                style={{ width: `${progress ?? 8}%` }}
                                            />
                                        </div>
                                    </div>
                                )}
                                {status === "installed" && <p className="text-muted-foreground">Update installed. Restarting Morrow…</p>}
                            </div>
                        )}
                        {status === "error" && (
                            <p
                                role="alert"
                                className="break-words text-destructive"
                            >
                                Could not check or install the update: {error}
                            </p>
                        )}
                        <div className="flex justify-end gap-2 pt-2">
                            <Button
                                variant="outline"
                                onClick={() => void updater.checkForUpdates(true)}
                                disabled={updater.busy || status === "unconfigured"}
                            >
                                <RefreshCw className={status === "checking" ? "animate-spin" : ""} /> Check now
                            </Button>
                            {status === "available" && (
                                <Button onClick={() => void updater.installUpdate()}>
                                    <ArrowDownToLine /> Download and install
                                </Button>
                            )}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
