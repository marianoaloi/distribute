// Keyset page loop: fetch a page after the last cursor, hand it to visit,
// repeat until a page comes back empty or shouldStop() says to quit (polled
// between pages, so a page in flight always completes). Pure - the fetch is
// injected - so it can be unit-tested without SQLite.
export interface Page<T> {
    rows: T[];
    // Cursor to resume after this page (e.g. its last rowid).
    next: number;
}

export interface PageLoopResult {
    pages: number;
    rows: number;
    stopped: boolean;
}

export const DEFAULT_PAGE_SIZE = 500;

export const forEachPage = async <T>(
    fetch: (after: number, limit: number) => Page<T>,
    visit: (rows: T[]) => Promise<void> | void,
    options: { pageSize?: number; start?: number; shouldStop?: () => boolean } = {},
): Promise<PageLoopResult> => {
    const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    if (!Number.isInteger(pageSize) || pageSize <= 0) throw new Error(`invalid page size ${pageSize}`);
    let cursor = options.start ?? 0;
    const result: PageLoopResult = { pages: 0, rows: 0, stopped: false };
    for (;;) {
        if (options.shouldStop?.()) { result.stopped = true; break; }
        const page = fetch(cursor, pageSize);
        if (page.rows.length === 0) break;
        // A cursor that does not advance would loop forever on the same page.
        if (page.next <= cursor) throw new Error(`page cursor did not advance (${cursor} -> ${page.next})`);
        cursor = page.next;
        await visit(page.rows);
        result.pages++;
        result.rows += page.rows.length;
    }
    return result;
};
