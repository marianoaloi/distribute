// Feeds reporting/report.ts: turns duplicate groups (lists of media ids) into
// ReportGroups, looking the members up in the media table a batch of groups
// at a time (never the whole table) and checking each member's file is
// still where the DB says it is.
import fs from "fs";
import * as MediaStore from "../mediaDb/MediaStore";
import { buildReportGroup, type MemberInfo, type ReportAlgorithm, type ReportGroup } from "./report";

// Member ids looked up per batch of groups.
export const IDS_PER_BATCH = 2000;

export async function* reportGroupsFor(algorithm: ReportAlgorithm, groups: readonly string[][]): AsyncGenerator<ReportGroup> {
    let start = 0;
    while (start < groups.length) {
        let end = start;
        let ids = 0;
        while (end < groups.length && (ids === 0 || ids + groups[end].length <= IDS_PER_BATCH)) {
            ids += groups[end].length;
            end++;
        }
        const batch = groups.slice(start, end);
        const rows = MediaStore.findMediaByIds([...new Set(batch.flat())]);
        for (const group of batch) {
            const members: MemberInfo[] = [];
            for (const id of group) {
                const row = rows.get(id);
                // A member the media table no longer knows (e.g. relocated by
                // "send filed media back") cannot be described: leave it out.
                if (!row) continue;
                members.push({
                    id: row.id,
                    path: row.localPath,
                    size: row.size,
                    kind: row.kind,
                    mime: row.mime ?? "",
                    hasAudio: Boolean(row.hasAudio),
                    contentMd5: row.contentMd5 ?? null,
                    missing: !fs.existsSync(row.localPath),
                });
            }
            const built = buildReportGroup(algorithm, members);
            if (built) yield built;
        }
        start = end;
        // Keep signals/IO serviced on a big report.
        await new Promise<void>(resolve => setImmediate(resolve));
    }
}
