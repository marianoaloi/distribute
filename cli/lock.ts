// One headless LSR run per media root: <root>/tmp/lsr.lock holds the owner's
// pid. Two runs writing the same index.db would interleave their progress
// and stall each other on SQLite write locks. A lock whose pid is no longer
// alive (crash, kill -9) is taken over. The GUI does not know about it.
import fs from "fs";
import path from "path";

export const lockPathFor = (root: string): string => path.join(root, "tmp", "lsr.lock");

const isAlive = (pid: number): boolean => {
    try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
};

export type LockResult = { ok: true; release(): void } | { ok: false; error: string };

export const acquireLock = (root: string, pid: number = process.pid): LockResult => {
    const lockPath = lockPathFor(root);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            fs.writeFileSync(lockPath, String(pid), { flag: "wx" });
            return {
                ok: true,
                release: () => {
                    try { if (fs.readFileSync(lockPath, "utf8").trim() === String(pid)) fs.unlinkSync(lockPath); } catch { /* already gone */ }
                },
            };
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") return { ok: false, error: `cannot create ${lockPath}: ${(error as Error).message}` };
            let owner = NaN;
            try { owner = parseInt(fs.readFileSync(lockPath, "utf8").trim(), 10); } catch { /* vanished meanwhile: retry */ }
            if (Number.isInteger(owner) && owner > 0 && owner !== pid && isAlive(owner)) {
                return { ok: false, error: `another LSR run (pid ${owner}) is already working on this folder (${lockPath})` };
            }
            try { fs.unlinkSync(lockPath); } catch { /* raced with another taker: retry once */ }
        }
    }
    return { ok: false, error: `could not take ${lockPath}` };
};
