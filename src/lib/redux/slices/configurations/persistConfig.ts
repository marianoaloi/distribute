// Small localStorage-backed persistence for the config fields the user
// wants remembered across restarts: how many items per page, and where they
// were scrolled to (page is included since a raw scroll offset is meaningless
// without knowing which page it belongs to).
const STORAGE_KEY = "distribute.config";

export interface PersistedConfig {
    postsPerPage: number
    page: number
    scrollPosition: number
}

export const loadPersistedConfig = (): Partial<PersistedConfig> => {
    if (typeof localStorage === "undefined") return {};
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
};

export const savePersistedConfig = (config: PersistedConfig) => {
    if (typeof localStorage === "undefined") return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
        // best-effort - a full quota or serialization error shouldn't break the app
    }
};
