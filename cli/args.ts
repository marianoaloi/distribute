// Command-line parsing + boundary validation for the headless LSR runner
// (cli/lsr.ts). Pure apart from read-only fs checks on the given paths, and
// free of native imports so --help and usage errors work under plain node.
import fs from "fs";
import path from "path";
import { checkReportTargets, parseFormats, reportStem, targetsFor, type ReportFormat } from "./reportArgs";

// Canonical execution order; --stages is re-sorted into it.
export const STAGE_ORDER = ["scan", "hash", "index", "detect", "duplicates", "extraDups", "report"] as const;
export type CliStage = typeof STAGE_ORDER[number];

export interface CliOptions {
    root: string;
    maloi?: string;
    stages: CliStage[];
    verbose: boolean;
    // Report path without extension (absolute); undefined = the default
    // <root>/tmp/reports/lsr-<stamp>.
    reportStem?: string;
    reportFormats: ReportFormat[];
}

export type ParseOutcome =
    | { ok: true; help: true }
    | { ok: true; help: false; options: CliOptions }
    | { ok: false; error: string };

export const USAGE = `Usage:
  ELECTRON_RUN_AS_NODE=1 electron electron-dist/cli/lsr.js --root <mediaRoot> [--maloi <file.maloi>] [options]

Headless "Load super recursive": scans <mediaRoot> recursively and fills the
same per-folder database the GUI uses (<mediaRoot>/tmp/hashIndex/index.db).
Never moves or deletes media. Safe to interrupt and re-run: finished work is
skipped on the next run.

Options:
  --root <dir>        Media folder to process (required).
  --maloi <file>      .maloi model set (ONNX model + classes). Required when
                      the "detect" stage runs.
  --stages <list>     Comma-separated subset of: ${STAGE_ORDER.join(",")}
                      (default: all, always run in that order).
                      duplicates = pixel comparison (persisted, as in the
                      GUI); extraDups = the GUI's other three algorithms
                      (shared detection boxes, frame signature, blurred
                      frames), computed on demand and not persisted; each
                      gets LSR_EXTRA_DUPS_MINUTES (default 60) and
                      LSR_EXTRA_DUPS_MAX_MB of memory (default 4096) before
                      it is abandoned and reported as failed.
                      report = every duplicate group (pixel groups as last
                      persisted; the other algorithms from this run's
                      extraDups, or computed again). Only pixel groups get
                      keep/remove (one keep per group); the other
                      algorithms' members are "review" (check by hand).
                      Advisory only: nothing is moved or deleted.
  --report <path>     Decision report file (default:
                      <mediaRoot>/tmp/reports/lsr-<timestamp>.json). An
                      existing file is only replaced if it is an earlier
                      LSR report.
  --format <list>     json, csv or json,csv (default json). The file names
                      come from --report with its .json/.csv extension
                      replaced, so "--report r.csv --format json" writes
                      r.json.
  --verbose           Also print per-item log lines to stdout (they always go
                      to the run log under <mediaRoot>/tmp/logs/).
  --help              Show this help.

Do not run the GUI on the same folder while this runs: only CLI runs take
the <mediaRoot>/tmp/lsr.lock lock, so the two would write index.db at once.

Symlinks and special files (fifos, sockets, devices) are skipped.

A run whose progress stops moving for 30 minutes is treated as hung and
exits with code 3 (set LSR_STALL_MINUTES to change that).

Exit codes:
  0    finished
  1    finished, but some items failed (see the run log)
  2    usage or configuration error
  3    a stage failed - including a stage where every item it tried
       failed (at least 5 tried; later stages are then skipped), or a
       hung run
  130  interrupted (SIGINT/SIGTERM) - re-run to continue
`;

// Kernel pseudo-filesystems: never media, and reading some entries blocks.
const PSEUDO_FS = ["/proc", "/sys", "/dev"];

const VALUE_FLAGS = new Set(["--root", "--maloi", "--stages", "--report", "--format"]);
const BOOL_FLAGS = new Set(["--verbose", "--help", "-h"]);

export const parseStages = (raw: string): { ok: true; stages: CliStage[] } | { ok: false; error: string } => {
    const names = raw.split(",").map(s => s.trim()).filter(Boolean);
    if (names.length === 0) return { ok: false, error: `--stages is empty; valid stages: ${STAGE_ORDER.join(", ")}` };
    const unknown = names.filter(n => !(STAGE_ORDER as readonly string[]).includes(n));
    if (unknown.length > 0) return { ok: false, error: `unknown stage(s): ${unknown.join(", ")}; valid stages: ${STAGE_ORDER.join(", ")}` };
    return { ok: true, stages: STAGE_ORDER.filter(s => names.includes(s)) };
};

const isDirectory = (p: string): boolean => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p: string): boolean => { try { return fs.statSync(p).isFile(); } catch { return false; } };

// A root inside some library's own tmp/ folder (its index, frames, move
// destinations) would index the app's data as if it were media.
const insideAppTmp = (root: string): string | null => {
    let dir = root;
    for (;;) {
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        if (path.basename(dir) === "tmp" && isDirectory(path.join(dir, "hashIndex"))) return dir;
        dir = parent;
    }
};

export const parseArgs = (argv: readonly string[]): ParseOutcome => {
    const values: Record<string, string> = {};
    const bools = new Set<string>();
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
        const flag = eq > 0 ? arg.slice(0, eq) : arg;
        if (VALUE_FLAGS.has(flag)) {
            const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
            if (value === undefined || (eq < 0 && value.startsWith("--"))) return { ok: false, error: `${flag} needs a value` };
            if (flag in values) return { ok: false, error: `${flag} given more than once` };
            values[flag] = value;
        } else if (BOOL_FLAGS.has(flag) && eq < 0) {
            bools.add(flag);
        } else {
            return { ok: false, error: `unknown argument: ${arg}` };
        }
    }
    if (bools.has("--help") || bools.has("-h")) return { ok: true, help: true };

    if (!values["--root"]) return { ok: false, error: "--root is required" };
    const root = path.resolve(values["--root"]);
    if (!isDirectory(root)) return { ok: false, error: `--root is not an existing folder: ${root}` };
    if (path.parse(root).root === root) return { ok: false, error: `--root cannot be the filesystem root (${root})` };
    if (PSEUDO_FS.some(p => root === p || root.startsWith(p + path.sep))) return { ok: false, error: `--root cannot be a pseudo-filesystem (${root})` };
    const appTmp = insideAppTmp(root);
    if (appTmp) return { ok: false, error: `--root is inside an app data folder (${appTmp}); point it at the media folder itself` };

    let stages: CliStage[] = [...STAGE_ORDER];
    if (values["--stages"] !== undefined) {
        const parsed = parseStages(values["--stages"]);
        if (!parsed.ok) return parsed;
        stages = parsed.stages;
    }

    let maloi: string | undefined;
    if (values["--maloi"] !== undefined) {
        maloi = path.resolve(values["--maloi"]);
        if (!isFile(maloi)) return { ok: false, error: `--maloi file not found: ${maloi}` };
    } else if (stages.includes("detect")) {
        return { ok: false, error: "--maloi is required when the \"detect\" stage runs (or leave it out with --stages)" };
    }

    let reportFormats: ReportFormat[] = ["json"];
    if (values["--format"] !== undefined) {
        const parsed = parseFormats(values["--format"]);
        if (!parsed.ok) return parsed;
        reportFormats = parsed.formats;
    }
    if ((values["--report"] !== undefined || values["--format"] !== undefined) && !stages.includes("report")) {
        return { ok: false, error: "--report/--format given, but the \"report\" stage is not selected" };
    }
    let stem: string | undefined;
    if (values["--report"] !== undefined) {
        if (values["--report"].trim() === "") return { ok: false, error: "--report needs a path" };
        stem = reportStem(values["--report"]);
        const problem = checkReportTargets(targetsFor(stem, reportFormats));
        if (problem) return { ok: false, error: problem };
    }

    return { ok: true, help: false, options: { root, maloi, stages, verbose: bools.has("--verbose"), reportStem: stem, reportFormats } };
};
