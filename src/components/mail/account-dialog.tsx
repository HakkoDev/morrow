import { LoaderCircle } from "lucide-react";
import { cloneElement, type ReactElement, useEffect, useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { mailApi } from "@/lib/mail-api";
import type { Account, AccountInput, SecurityMode } from "@/lib/types";
import { ConfirmActionDialog } from "./mail-action-dialogs";

const blankAccount = (): AccountInput => ({
    id: "",
    displayName: "",
    email: "",
    imapHost: "",
    imapPort: 993,
    imapSecurity: "tls",
    imapUsername: "",
    smtpHost: "",
    smtpPort: 465,
    smtpSecurity: "tls",
    smtpUsername: "",
    sentFolder: "Sent",
    draftsFolder: "Drafts",
    trashFolder: "Trash",
    saveSentCopy: true,
    imapPassword: "",
    smtpPassword: "",
});

const presets: Record<string, Partial<AccountInput>> = {
    "gmail.com": {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        imapSecurity: "tls",
        smtpHost: "smtp.gmail.com",
        smtpPort: 465,
        smtpSecurity: "tls",
        sentFolder: "[Gmail]/Sent Mail",
        draftsFolder: "[Gmail]/Drafts",
        trashFolder: "[Gmail]/Trash",
        saveSentCopy: false,
    },
    "googlemail.com": {
        imapHost: "imap.gmail.com",
        imapPort: 993,
        imapSecurity: "tls",
        smtpHost: "smtp.gmail.com",
        smtpPort: 465,
        smtpSecurity: "tls",
        sentFolder: "[Gmail]/Sent Mail",
        draftsFolder: "[Gmail]/Drafts",
        trashFolder: "[Gmail]/Trash",
        saveSentCopy: false,
    },
    "yahoo.com": { imapHost: "imap.mail.yahoo.com", imapPort: 993, imapSecurity: "tls", smtpHost: "smtp.mail.yahoo.com", smtpPort: 465, smtpSecurity: "tls" },
    "icloud.com": { imapHost: "imap.mail.me.com", imapPort: 993, imapSecurity: "tls", smtpHost: "smtp.mail.me.com", smtpPort: 587, smtpSecurity: "startTls" },
};

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    account?: Account | null;
    onSaved: (account: Account) => void | Promise<void>;
    onDeleted?: (accountId: string) => void | Promise<void>;
}

export function AccountDialog({ open, onOpenChange, account, onSaved, onDeleted }: Props) {
    const [form, setForm] = useState<AccountInput>(blankAccount());
    const [samePassword, setSamePassword] = useState(true);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);

    useEffect(() => {
        if (!open) return;
        setMessage(null);
        setSamePassword(true);
        if (account) setForm({ ...account, imapPassword: "", smtpPassword: "" });
        else setForm(blankAccount());
    }, [open, account]);

    const domain = useMemo(() => form.email.split("@")[1]?.toLowerCase(), [form.email]);

    function update<K extends keyof AccountInput>(key: K, value: AccountInput[K]) {
        setForm((current) => ({ ...current, [key]: value }));
    }

    function applyRecommendedSettings() {
        const preset = domain ? presets[domain] : undefined;
        const username = form.email.trim();
        if (preset) {
            setForm((current) => ({ ...current, ...preset, imapUsername: username, smtpUsername: username }));
            return;
        }
        if (!domain) return;
        setForm((current) => ({
            ...current,
            imapHost: `mail.${domain}`,
            imapPort: 993,
            imapSecurity: "tls",
            imapUsername: username,
            smtpHost: `mail.${domain}`,
            smtpPort: 465,
            smtpSecurity: "tls",
            smtpUsername: username,
        }));
    }

    const payload = (): AccountInput => ({
        ...form,
        smtpPassword: samePassword ? form.imapPassword : form.smtpPassword,
    });

    async function test() {
        setBusy(true);
        setMessage("Testing IMAP and SMTP…");
        try {
            const result = await mailApi.testAccount(payload());
            setMessage(result.imap && result.smtp ? "IMAP and SMTP both connected successfully." : "One of the connections failed.");
        } catch (error) {
            setMessage(String(error));
        } finally {
            setBusy(false);
        }
    }

    async function save() {
        setBusy(true);
        setMessage(null);
        try {
            const saved = await mailApi.saveAccount(payload());
            await onSaved(saved);
            onOpenChange(false);
        } catch (error) {
            setMessage(String(error));
        } finally {
            setBusy(false);
        }
    }

    async function removeAccount() {
        if (!account) return;
        setConfirmRemoveOpen(false);
        setBusy(true);
        try {
            await mailApi.deleteAccount(account.id);
            await onDeleted?.(account.id);
            onOpenChange(false);
        } catch (error) {
            setMessage(String(error));
        } finally {
            setBusy(false);
        }
    }

    return (
        <>
            <Dialog
                open={open}
                onOpenChange={onOpenChange}
            >
                <DialogContent className="max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{account ? "Edit account" : "Add mail account"}</DialogTitle>
                        <DialogDescription>
                            Connect directly to an IMAP inbox and SMTP submission server. Credentials are stored in your operating system credential vault.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-5">
                        <section className="grid gap-3">
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="Your name">
                                    <Input
                                        value={form.displayName}
                                        onChange={(e) => update("displayName", e.target.value)}
                                        placeholder="Jane Doe"
                                    />
                                </Field>
                                <Field label="Email">
                                    <Input
                                        value={form.email}
                                        onChange={(e) => update("email", e.target.value)}
                                        onBlur={() => {
                                            if (!form.imapHost) applyRecommendedSettings();
                                        }}
                                        placeholder="jane@example.com"
                                    />
                                </Field>
                            </div>
                            <div className="flex justify-end">
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={applyRecommendedSettings}
                                    disabled={!domain}
                                >
                                    Guess server settings
                                </Button>
                            </div>
                        </section>

                        <ServerSection
                            title="Incoming mail (IMAP)"
                            host={form.imapHost}
                            port={form.imapPort}
                            security={form.imapSecurity}
                            username={form.imapUsername}
                            password={form.imapPassword || ""}
                            onHost={(v) => update("imapHost", v)}
                            onPort={(v) => update("imapPort", v)}
                            onSecurity={(v) => update("imapSecurity", v)}
                            onUsername={(v) => update("imapUsername", v)}
                            onPassword={(v) => update("imapPassword", v)}
                        />

                        <ServerSection
                            title="Outgoing mail (SMTP)"
                            host={form.smtpHost}
                            port={form.smtpPort}
                            security={form.smtpSecurity}
                            username={form.smtpUsername}
                            password={samePassword ? form.imapPassword || "" : form.smtpPassword || ""}
                            onHost={(v) => update("smtpHost", v)}
                            onPort={(v) => update("smtpPort", v)}
                            onSecurity={(v) => update("smtpSecurity", v)}
                            onUsername={(v) => update("smtpUsername", v)}
                            onPassword={(v) => update("smtpPassword", v)}
                            passwordDisabled={samePassword}
                        />

                        <label className="flex items-center gap-2 text-sm text-muted-foreground">
                            <input
                                type="checkbox"
                                checked={samePassword}
                                onChange={(e) => setSamePassword(e.target.checked)}
                            />{" "}
                            Use the IMAP password for SMTP
                        </label>

                        <details className="rounded-lg border border-border bg-muted/25 p-3">
                            <summary className="cursor-pointer text-sm font-medium">Folder mapping</summary>
                            <div className="mt-3 grid grid-cols-3 gap-3">
                                <Field label="Sent">
                                    <Input
                                        value={form.sentFolder}
                                        onChange={(e) => update("sentFolder", e.target.value)}
                                    />
                                </Field>
                                <Field label="Drafts">
                                    <Input
                                        value={form.draftsFolder}
                                        onChange={(e) => update("draftsFolder", e.target.value)}
                                    />
                                </Field>
                                <Field label="Trash">
                                    <Input
                                        value={form.trashFolder}
                                        onChange={(e) => update("trashFolder", e.target.value)}
                                    />
                                </Field>
                            </div>
                        </details>

                        <label className="flex items-start gap-2 rounded-lg border border-border bg-muted/20 p-3 text-sm">
                            <input
                                className="mt-0.5"
                                type="checkbox"
                                checked={form.saveSentCopy}
                                onChange={(e) => update("saveSentCopy", e.target.checked)}
                            />
                            <span>
                                <span className="block font-medium">Save a sent copy through IMAP</span>
                                <span className="mt-0.5 block text-xs text-muted-foreground">
                                    Keep this enabled for normal SMTP servers. Disable it when your provider already stores SMTP submissions in Sent (the Gmail
                                    preset does this automatically).
                                </span>
                            </span>
                        </label>

                        {message && <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{message}</div>}
                        <div className="flex items-center justify-between gap-2">
                            <div>
                                {account && (
                                    <Button
                                        variant="destructive"
                                        onClick={() => setConfirmRemoveOpen(true)}
                                        disabled={busy}
                                    >
                                        Remove account
                                    </Button>
                                )}
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    onClick={test}
                                    disabled={busy || !form.email || !form.imapHost || !form.smtpHost}
                                >
                                    {busy && <LoaderCircle className="animate-spin" />} Test connection
                                </Button>
                                <Button
                                    onClick={save}
                                    disabled={busy || !form.email || !form.imapHost || !form.smtpHost}
                                >
                                    {busy && <LoaderCircle className="animate-spin" />} Save account
                                </Button>
                            </div>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
            <ConfirmActionDialog
                open={confirmRemoveOpen}
                title="Remove account?"
                description={`Remove ${account?.email ?? "this account"} and its local cache and credentials? Server messages will not be removed.`}
                confirmLabel="Remove account"
                busy={busy}
                onClose={() => setConfirmRemoveOpen(false)}
                onConfirm={() => void removeAccount()}
            />
        </>
    );
}

// Associate the visible label with the actual input/select, including the
// custom shadcn Input component (which forwards its id to the native element).
function Field({ label, children }: { label: string; children: ReactElement<{ id?: string }> }) {
    const id = useId();
    return (
        <div className="grid gap-1.5 text-xs font-medium text-muted-foreground">
            <label htmlFor={id}>{label}</label>
            {cloneElement(children, { id })}
        </div>
    );
}

function ServerSection(props: {
    title: string;
    host: string;
    port: number;
    security: SecurityMode;
    username: string;
    password: string;
    onHost: (v: string) => void;
    onPort: (v: number) => void;
    onSecurity: (v: SecurityMode) => void;
    onUsername: (v: string) => void;
    onPassword: (v: string) => void;
    passwordDisabled?: boolean;
}) {
    return (
        <section className="grid gap-3 rounded-xl border border-border bg-muted/15 p-4">
            <h3 className="text-sm font-semibold">{props.title}</h3>
            <div className="grid grid-cols-[1fr_100px_140px] gap-3">
                <Field label="Hostname">
                    <Input
                        value={props.host}
                        onChange={(e) => props.onHost(e.target.value)}
                        placeholder="mail.example.com"
                    />
                </Field>
                <Field label="Port">
                    <Input
                        type="number"
                        value={props.port}
                        onChange={(e) => props.onPort(Number(e.target.value))}
                    />
                </Field>
                <Field label="Security">
                    <select
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                        value={props.security}
                        onChange={(e) => props.onSecurity(e.target.value as SecurityMode)}
                    >
                        <option value="tls">TLS</option>
                        <option value="startTls">STARTTLS</option>
                        <option value="plain">Plain (unsafe)</option>
                    </select>
                </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
                <Field label="Username">
                    <Input
                        value={props.username}
                        onChange={(e) => props.onUsername(e.target.value)}
                    />
                </Field>
                <Field label="Password">
                    <Input
                        type="password"
                        value={props.password}
                        onChange={(e) => props.onPassword(e.target.value)}
                        disabled={props.passwordDisabled}
                        placeholder={props.passwordDisabled ? "Uses IMAP password" : "Password / app password"}
                    />
                </Field>
            </div>
        </section>
    );
}
