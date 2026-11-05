// Command-line parsing + boundary validation for the headless LSR runner
// (cli/lsr.ts). Pure apart from read-only fs checks on the given paths, and
// free of native imports so --help and usage errors work under plain node.
import fs from "fs";
import path from "path";

// Canonical execution order; --stages is re-sorted into it.
export const STAGE_ORDER = ["scan", "hash", "index", "detect", "duplicates"] as const;
export type CliStage = typeof STAGE_ORDER[number];

export interface CliOptions {
    root: string;
    maloi?: string;
    stages: CliStage[];
    verbose: boolean;
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
  --verbose           Also print per-item log lines to stdout (they always go
                      to the run log under <mediaRoot>/tmp/logs/).
  --help              Show this help.

Exit codes:
  0    finished
  1    finished, but some items failed (see the run log)
  2    usage or configuration error
  3    a stage failed
  130  interrupted (SIGINT/SIGTERM) - re-run to continue
`;

const VALUE_FLAGS = new Set(["--root", "--maloi", "--stages"]);
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

    return { ok: true, help: false, options: { root, maloi, stages, verbose: bools.has("--verbose") } };
};
