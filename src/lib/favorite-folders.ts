const KEY = "morrow.favorite-folders.v1";
function read(): Record<string, string[]> {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(KEY) || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const safe: Record<string, string[]> = {};
        for (const [accountId, folders] of Object.entries(parsed)) {
            if (Array.isArray(folders)) safe[accountId] = folders.filter((item): item is string => typeof item === "string").slice(0, 100);
        }
        return safe;
    } catch {
        return {};
    }
}
export function favoriteFolders(accountId: string): string[] {
    return read()[accountId] || [];
}
export function toggleFavoriteFolder(accountId: string, folder: string): string[] {
    if (!accountId || !folder) return [];
    const data = read();
    const previous = data[accountId] || [];
    const updated = previous.includes(folder) ? previous.filter((name) => name !== folder) : [...previous, folder].slice(0, 100);
    data[accountId] = updated;
    try {
        localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
        /* Favorites still work until restart */
    }
    return updated;
}
