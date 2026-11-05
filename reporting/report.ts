// Decision report of the headless LSR: every duplicate group, per algorithm,
// with the suggested survivor (reporting/survivor.ts) and what removing the
// rest would reclaim. Purely advisory - nothing here (or anywhere in the
// CLI) moves or deletes media; the only files written are the report itself.
//
// Pure apart from the streaming writers (plain fs), no native imports, so it
// is unit-testable under jest.
import fs from "fs";
import crypto from "crypto";
import { pickSurvivor } from "./survivor";

export type ReportAlgorithm = "pixel" | "objects" | "frames" | "blurFrames";

export interface MemberInfo {
    id: string;
    path: string;
    size: number;
    kind: string;
    mime: string;
    hasAudio: boolean;
    contentMd5: string | null;
    // The file is no longer at path (moved/deleted since it was indexed).
    missing: boolean;
}

// keep / remove: only in groups of an algorithm that finds real duplicates
// (DECIDING_ALGORITHMS). review: a member of a similarity group (shared
// detection box, frame signature, blurred frames) - possibly a duplicate,
// for manual review, never suggested for removal. missing: gone from disk.
export type MemberRole = "keep" | "remove" | "review" | "missing";

// The only algorithm whose groups get keep/remove: pixel-level near-identity
// (the persisted duplicate scan). The others match on looser signals and can
// group media that are not duplicates: objects = a shared detection box,
// blurFrames = shared blurred frames, frames = the same frame timestamps and
// detected-class COUNT (not content). Their groups also overlap each other
// and the pixel groups, so independent per-group survivors could mark every
// copy of a file "remove" across algorithms. The caller must hand in the
// deciding groups already merged into disjoint clusters (mergeGroups), so
// each file gets exactly one decision and every cluster keeps one file.
export const DECIDING_ALGORITHMS: readonly ReportAlgorithm[] = ["pixel"];

export interface ReportMember extends MemberInfo { role: MemberRole }

export interface ReportGroup {
    algorithm: ReportAlgorithm;
    // sha1 of the sorted member ids: stable across runs for the same group
    // (the pixel scan's own stored group ids are regenerated every scan).
    groupId: string;
    // The suggested file to keep; null for a review-only group.
    survivorId: string | null;
    // Bytes freed by removing the "remove" members (0 for review groups).
    reclaimableBytes: number;
    members: ReportMember[];
}

export const groupIdFor = (ids: readonly string[]): string =>
    crypto.createHash("sha1").update([...ids].sort().join("\n")).digest("hex");

// One group's decision. Missing members never survive and are never
// "remove" (there is nothing left to remove); a group with fewer than two
// members still on disk is no longer a duplicate group and yields null.
export const buildReportGroup = (algorithm: ReportAlgorithm, members: readonly MemberInfo[]): ReportGroup | null => {
    const present = members.filter(m => !m.missing);
    if (present.length < 2) return null;
    const decides = DECIDING_ALGORITHMS.includes(algorithm);
    const survivor = decides ? pickSurvivor(present) : undefined;
    if (decides && !survivor) return null;
    const out: ReportMember[] = members.map(m => ({
        ...m,
        role: m.missing ? "missing" : !survivor ? "review" : m.id === survivor.id ? "keep" : "remove",
    }));
    return {
        algorithm,
        groupId: groupIdFor(members.map(m => m.id)),
        survivorId: survivor ? survivor.id : null,
        reclaimableBytes: out.filter(m => m.role === "remove").reduce((sum, m) => sum + m.size, 0),
        members: out,
    };
};

export interface ReportTotals {
    groupsByAlgorithm: Record<string, number>;
    membersByAlgorithm: Record<string, number>;
    reclaimableBytesByAlgorithm: Record<string, number>;
    // Every "remove" file counted once, whatever groups it appears in.
    reclaimableBytes: number;
    removeFiles: number;
}

export const emptyTotals = (): ReportTotals => ({ groupsByAlgorithm: {}, membersByAlgorithm: {}, reclaimableBytesByAlgorithm: {}, reclaimableBytes: 0, removeFiles: 0 });

export const addToTotals = (totals: ReportTotals, group: ReportGroup, removedIds: Set<string> = new Set()): void => {
    for (const m of group.members) {
        if (m.role !== "remove" || removedIds.has(m.id)) continue;
        removedIds.add(m.id);
        totals.reclaimableBytes += m.size;
        totals.removeFiles++;
    }
    const a = group.algorithm;
    totals.groupsByAlgorithm[a] = (totals.groupsByAlgorithm[a] ?? 0) + 1;
    totals.membersByAlgorithm[a] = (totals.membersByAlgorithm[a] ?? 0) + group.members.length;
    totals.reclaimableBytesByAlgorithm[a] = (totals.reclaimableBytesByAlgorithm[a] ?? 0) + group.reclaimableBytes;
};

export const formatBytes = (bytes: number): string => {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
    return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
};

// RFC 4180: quote a field holding a comma, quote, CR or LF; double quotes.
export const csvEscape = (value: unknown): string => {
    const s = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const CSV_HEADER = ["algorithm", "groupId", "role", "id", "path", "size", "kind", "hasAudio", "contentMd5"];

export const csvRowsFor = (group: ReportGroup): string[] =>
    group.members.map(m => [group.algorithm, group.groupId, m.role, m.id, m.path, m.size, m.kind, m.hasAudio ? 1 : 0, m.contentMd5]
        .map(csvEscape).join(","));

const isSymlink = (p: string): boolean => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };

// A <target>.tmp the report may replace: a symlink (removed, never followed),
// an empty file (killed before the first write), or a partial report (the
// header is written first).
export const isStaleReportTmp = (tmpPath: string): boolean => {
    if (isSymlink(tmpPath)) return true;
    let head = "";
    try {
        const fd = fs.openSync(tmpPath, "r");
        try {
            const buffer = Buffer.alloc(256);
            head = buffer.subarray(0, fs.readSync(fd, buffer, 0, buffer.length, 0)).toString("utf8");
        } finally {
            fs.closeSync(fd);
        }
    } catch {
        return false;
    }
    return head === "" || head.startsWith('{"generatedAt"') || head.startsWith(`${CSV_HEADER.join(",")}\n`) || `${CSV_HEADER.join(",")}\n`.startsWith(head);
};

// Minimal backpressure-aware line writer over a WriteStream. It writes to
// <file>.tmp and only commit() renames that onto <file>, so a run killed
// mid-report never leaves a truncated report behind (just a stray .tmp).
const openWriter = (filePath: string): { write(text: string): Promise<void>; close(): Promise<void>; commit(): void; discard(): void } => {
    const tmpPath = `${filePath}.tmp`;
    // A stale .tmp from a run killed mid-report is dropped first - but only
    // one that is ours (see isStaleReportTmp); anything else is refused, so
    // the report never deletes a file it did not write. unlink removes a
    // symlink itself, never its target; the new file is then created
    // exclusively, so nothing can redirect the write.
    if (fs.existsSync(tmpPath) || isSymlink(tmpPath)) {
        if (!isStaleReportTmp(tmpPath)) throw new Error(`${tmpPath} exists and is not a leftover LSR report; remove it or choose another --report path`);
        fs.unlinkSync(tmpPath);
    }
    const stream = fs.createWriteStream(tmpPath, { fd: fs.openSync(tmpPath, "wx") });
    let failure: Error | null = null;
    stream.on("error", (error) => { failure = error; });
    return {
        write: (text) => new Promise<void>((resolve, reject) => {
            if (failure) { reject(failure); return; }
            if (stream.write(text)) resolve();
            else stream.once("drain", () => (failure ? reject(failure) : resolve()));
        }),
        close: () => new Promise<void>((resolve, reject) => {
            stream.end(() => (failure ? reject(failure) : resolve()));
        }),
        commit: () => fs.renameSync(tmpPath, filePath),
        discard: () => { try { fs.unlinkSync(tmpPath); } catch { /* already gone */ } },
    };
};

export interface ReportHeader {
    generatedAt: string;
    root: string;
    maloi?: string;
    stages: string[];
    // Per algorithm: how its groups were obtained, or why it has none.
    algorithms?: Record<string, string>;
    // When the pixel groups were persisted by a duplicates stage (ISO), or
    // null if unknown (none, or written before that was recorded).
    pixelGroupsSavedAt?: string | null;
}

export interface ReportTargets { json?: string; csv?: string }

// Streams the groups into the requested files, one group at a time - never a
// whole-report object in memory. JSON shape:
//   { generatedAt, root, maloi, stages, groups: [...], totals: {...} }
// Returns the totals.
export const writeReport = async (header: ReportHeader, groups: AsyncIterable<ReportGroup>, targets: ReportTargets): Promise<ReportTotals> => {
    const totals = emptyTotals();
    const removedIds = new Set<string>();
    const json = targets.json ? openWriter(targets.json) : null;
    let csv: ReturnType<typeof openWriter> | null = null;
    try {
        csv = targets.csv ? openWriter(targets.csv) : null;
    } catch (error) {
        if (json) { await json.close().catch(() => undefined); json.discard(); }
        throw error;
    }
    try {
        if (json) {
            const head = JSON.stringify({ ...header, groups: [] });
            await json.write(`${head.slice(0, head.length - "[]}".length)}[\n`);
        }
        if (csv) await csv.write(`${CSV_HEADER.join(",")}\n`);
        let first = true;
        for await (const group of groups) {
            addToTotals(totals, group, removedIds);
            if (json) { await json.write(`${first ? "" : ",\n"}${JSON.stringify(group)}`); }
            if (csv) { for (const row of csvRowsFor(group)) await csv.write(`${row}\n`); }
            first = false;
        }
        if (json) await json.write(`\n], "totals": ${JSON.stringify(totals)}}\n`);
    } catch (error) {
        await Promise.allSettled([json?.close(), csv?.close()]);
        json?.discard();
        csv?.discard();
        throw error;
    }
    await Promise.all([json?.close(), csv?.close()]);
    // Each format is renamed into place on its own: should the second rename
    // fail, the two files would be from different runs (the error is thrown).
    json?.commit();
    csv?.commit();
    return totals;
};
