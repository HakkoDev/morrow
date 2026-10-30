import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export function initials(value: string) {
    return (
        value
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0]?.toUpperCase())
            .join("") || "?"
    );
}

export function formatDate(timestamp: number) {
    if (!timestamp) return "";
    const date = new Date(timestamp * 1000);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
        return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
    }
    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
    }).format(date);
}

/** Uses the WebView's system locale, local timezone, and configured 12/24-hour clock. */
export function formatMessageDateTime(timestamp: number): string {
    if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
    return new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
    }).format(new Date(timestamp * 1000));
}
