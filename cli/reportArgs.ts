// Where the decision report goes (--report / --format), validated at the
// command-line boundary. Pure apart from read-only fs checks.
//
// The report never overwrites a file it did not write itself: an existing
// target must look like an earlier LSR report (a JSON report starts with
// {"generatedAt", a CSV one with the report's header line).
import fs from "fs";
import path from "path";
import { CSV_HEADER } from "../reporting/report";

export const REPORT_FORMATS = ["json", "csv"] as const;
export type ReportFormat = typeof REPORT_FORMATS[number];

export const parseFormats = (raw: string): { ok: true; formats: ReportFormat[] } | { ok: false; error: string } => {
    const names = raw.split(",").map(s => s.trim()).filter(Boolean);
    if (names.length === 0) return { ok: false, error: `--format is empty; valid formats: ${REPORT_FORMATS.join(", ")}` };
    const unknown = names.filter(n => !(REPORT_FORMATS as readonly string[]).includes(n));
    if (unknown.length > 0) return { ok: false, error: `unknown report format(s): ${unknown.join(", ")}; valid formats: ${REPORT_FORMATS.join(", ")}` };
    return { ok: true, formats: REPORT_FORMATS.filter(f => names.includes(f)) };
};

// "out/report.json" or "out/report" -> "out/report" (absolute).
export const reportStem = (reportArg: string): string => {
    const resolved = path.resolve(reportArg);
    const ext = path.extname(resolved).toLowerCase();
    return (REPORT_FORMATS as readonly string[]).includes(ext.slice(1)) ? resolved.slice(0, -ext.length) : resolved;
};

export const targetsFor = (stem: string, formats: readonly ReportFormat[]): Partial<Record<ReportFormat, string>> =>
    Object.fromEntries(formats.map(f => [f, `${stem}.${f}`]));

export const looksLikeLsrReport = (filePath: string): boolean => {
    let head = "";
    try {
        const fd = fs.openSync(filePath, "r");
        try {
            const buffer = Buffer.alloc(256);
            head = buffer.subarray(0, fs.readSync(fd, buffer, 0, buffer.length, 0)).toString("utf8");
        } finally {
            fs.closeSync(fd);
        }
    } catch {
        return false;
    }
    return head.startsWith('{"generatedAt"') || head.startsWith(`${CSV_HEADER.join(",")}\n`);
};

// Checks every target of an explicit --report: its folder exists, and it is
// either new or an earlier LSR report.
export const checkReportTargets = (targets: Partial<Record<ReportFormat, string>>): string | null => {
    for (const target of Object.values(targets)) {
        if (!target) continue;
        const dir = path.dirname(target);
        let dirOk = false;
        try { dirOk = fs.statSync(dir).isDirectory(); } catch { /* missing */ }
        if (!dirOk) return `--report folder does not exist: ${dir}`;
        if (!fs.existsSync(target)) continue;
        let isFile = false;
        try { isFile = fs.statSync(target).isFile(); } catch { /* vanished */ }
        if (!isFile) return `--report target is not a file: ${target}`;
        if (!looksLikeLsrReport(target)) return `--report would overwrite ${target}, which is not an LSR report; choose another path`;
    }
    return null;
};
