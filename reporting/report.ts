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

export type MemberRole = "keep" | "remove" | "missing";

export interface ReportMember extends MemberInfo { role: MemberRole }

export interface ReportGroup {
    algorithm: ReportAlgorithm;
    // sha1 of the sorted member ids: stable across runs for the same group
    // (the pixel scan's own stored group ids are regenerated every scan).
    groupId: string;
    survivorId: string;
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
    const survivor = pickSurvivor(present);
    if (!survivor) return null;
    const out: ReportMember[] = members.map(m => ({
        ...m,
        role: m.missing ? "missing" : m.id === survivor.id ? "keep" : "remove",
    }));
    return {
        algorithm,
        groupId: groupIdFor(members.map(m => m.id)),
        survivorId: survivor.id,
        reclaimableBytes: out.filter(m => m.role === "remove").reduce((sum, m) => sum + m.size, 0),
        members: out,
    };
};

export interface ReportTotals {
    groupsByAlgorithm: Record<string, number>;
    membersByAlgorithm: Record<string, number>;
    reclaimableBytesByAlgorithm: Record<string, number>;
}

export const emptyTotals = (): ReportTotals => ({ groupsByAlgorithm: {}, membersByAlgorithm: {}, reclaimableBytesByAlgorithm: {} });

export const addToTotals = (totals: ReportTotals, group: ReportGroup): void => {
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

// Minimal backpressure-aware line writer over a WriteStream.
const openWriter = (filePath: string): { write(text: string): Promise<void>; close(): Promise<void> } => {
    const stream = fs.createWriteStream(filePath, { fd: fs.openSync(filePath, "w") });
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
    };
};

export interface ReportHeader {
    generatedAt: string;
    root: string;
    maloi?: string;
    stages: string[];
    // Per algorithm: how its groups were obtained, or why it has none.
    algorithms?: Record<string, string>;
}

export interface ReportTargets { json?: string; csv?: string }

// Streams the groups into the requested files, one group at a time - never a
// whole-report object in memory. JSON shape:
//   { generatedAt, root, maloi, stages, groups: [...], totals: {...} }
// Returns the totals.
export const writeReport = async (header: ReportHeader, groups: AsyncIterable<ReportGroup>, targets: ReportTargets): Promise<ReportTotals> => {
    const totals = emptyTotals();
    const json = targets.json ? openWriter(targets.json) : null;
    const csv = targets.csv ? openWriter(targets.csv) : null;
    try {
        if (json) {
            const head = JSON.stringify({ ...header, groups: [] });
            await json.write(`${head.slice(0, head.length - "[]}".length)}[\n`);
        }
        if (csv) await csv.write(`${CSV_HEADER.join(",")}\n`);
        let first = true;
        for await (const group of groups) {
            addToTotals(totals, group);
            if (json) { await json.write(`${first ? "" : ",\n"}${JSON.stringify(group)}`); }
            if (csv) { for (const row of csvRowsFor(group)) await csv.write(`${row}\n`); }
            first = false;
        }
        if (json) await json.write(`\n], "totals": ${JSON.stringify(totals)}}\n`);
    } finally {
        await Promise.all([json?.close(), csv?.close()]);
    }
    return totals;
};
