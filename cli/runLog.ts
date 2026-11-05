// Run log for the headless LSR runner: one file per run under
// <root>/tmp/logs/lsr-<YYYYMMDD-HHMMSS>.log, written through a buffered
// stream (never appendFileSync - the existing modules log one line per item,
// i.e. millions of lines on a big library).
//
// Three kinds of line:
//   info/warn/error - the runner's own lines: file + stdout/stderr
//   detail          - everything the shared modules console.log: file only
//                     (stdout too with --verbose), so 1.2M per-item lines
//                     don't flood the terminal.
import fs from "fs";
import path from "path";

export const ROTATE_BYTES = 200 * 1024 * 1024;

export interface RunLog {
    readonly path: string;
    info(line: string): void;
    warn(line: string): void;
    error(line: string): void;
    detail(line: string): void;
    close(): Promise<void>;
}

export interface RunLogOptions {
    verbose?: boolean;
    now?: () => Date;
    rotateBytes?: number;
    stdout?: (text: string) => void;
    stderr?: (text: string) => void;
}

const pad = (n: number): string => String(n).padStart(2, "0");

export const stampFor = (d: Date): string =>
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

export const createRunLog = (root: string, options: RunLogOptions = {}): RunLog => {
    const now = options.now ?? (() => new Date());
    const rotateBytes = options.rotateBytes ?? ROTATE_BYTES;
    const stdout = options.stdout ?? ((text: string) => { process.stdout.write(text); });
    const stderr = options.stderr ?? ((text: string) => { process.stderr.write(text); });

    const dir = path.join(root, "tmp", "logs");
    fs.mkdirSync(dir, { recursive: true });
    // Two runs started in the same second must not share a file.
    const base = `lsr-${stampFor(now())}`;
    let logPath = path.join(dir, `${base}.log`);
    for (let n = 2; fs.existsSync(logPath); n++) logPath = path.join(dir, `${base}-${n}.log`);

    // Opened synchronously so the file exists before the first write: a
    // rotation can then always rename it, even in the very first tick.
    const open = (): fs.WriteStream => fs.createWriteStream(logPath, { fd: fs.openSync(logPath, "a") });
    let stream = open();
    let written = 0;
    let closed = false;

    // Keeps one previous segment (<log>.1): bounded disk use, and the end
    // summary always lands in <log> itself. Renamed while still open, so the
    // old stream's buffered lines simply finish in <log>.1.
    const rotate = (): void => {
        try {
            fs.renameSync(logPath, `${logPath}.1`);
        } catch {
            // Could not rotate: keep appending to the current file rather
            // than stacking a second stream on the same path.
            written = 0;
            return;
        }
        stream.end();
        stream = open();
        written = 0;
    };

    const toFile = (level: string, line: string): void => {
        if (closed) return;
        const text = `${now().toISOString()} ${level} ${line}\n`;
        const bytes = Buffer.byteLength(text);
        if (written + bytes > rotateBytes && written > 0) rotate();
        stream.write(text);
        written += bytes;
    };

    return {
        path: logPath,
        info: (line) => { toFile("INFO ", line); stdout(`${line}\n`); },
        warn: (line) => { toFile("WARN ", line); stderr(`WARN ${line}\n`); },
        error: (line) => { toFile("ERROR", line); stderr(`ERROR ${line}\n`); },
        detail: (line) => { toFile("DEBUG", line); if (options.verbose) stdout(`${line}\n`); },
        close: () => new Promise<void>((resolve) => {
            if (closed) { resolve(); return; }
            closed = true;
            stream.end(() => resolve());
        }),
    };
};

const formatArg = (a: unknown): string => {
    if (a instanceof Error) return a.stack || a.message;
    if (typeof a === "string") return a;
    try { return JSON.stringify(a); } catch { return String(a); }
};

export const formatArgs = (args: unknown[]): string => args.map(formatArg).join(" ");

export interface ConsoleCounters { errors: number; warnings: number }

// Routes the shared modules' console output into the run log. Returns
// counters (console.error calls are the modules' item-level failures - they
// decide exit code 1) and a restore function.
export const patchConsole = (log: RunLog): { counters: ConsoleCounters; restore(): void } => {
    const original = { log: console.log, info: console.info, debug: console.debug, warn: console.warn, error: console.error };
    const counters: ConsoleCounters = { errors: 0, warnings: 0 };
    console.log = (...args: unknown[]) => log.detail(formatArgs(args));
    console.info = console.log;
    console.debug = console.log;
    console.warn = (...args: unknown[]) => { counters.warnings++; log.warn(formatArgs(args)); };
    console.error = (...args: unknown[]) => { counters.errors++; log.error(formatArgs(args)); };
    return {
        counters,
        restore: () => Object.assign(console, original),
    };
};
