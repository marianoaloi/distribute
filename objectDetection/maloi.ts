// .maloi model-set files: a small JSON sidecar of the shape
// { "onnx": "<path>", "classes": "a,b,c", "reshape"?: n, "group"?: [...], "focus"?: [ids], "unfocus"?: [ids] }
// that sets the ONNX model *and* its class list (plus optional class-filter
// groups and a letterbox size override) in one pick.
//
// Shared by app.ts's chooseOnnxModelDialog (GUI) and cli/lsr.ts (headless).
// Deliberately electron-free and free of value imports of MediaStore (and so
// of better-sqlite3): readMaloi/parseMaloiGroups must load under plain node -
// the store is injected into applyMaloi instead.
import fs from "fs";
import path from "path";
import type { DetectionGroup } from "../mediaDb/MediaStore";
import { parseClassExpr, formatClassExpr, legacyGroupToExpr, type ParseResult } from "../mediaDb/classExpr";

export interface MaloiFile {
    onnx?: string;
    classes?: string;
    // Per-model override for onnxDetector's letterbox/tensor input
    // resolution (objectDetection/onnxDetector.js's setModelSize) - fixes
    // onnxruntime's native "ReshapeHelper ... input_shape_size ==
    // requested_shape_size was false" crash for models whose exported graph
    // bakes a Reshape op sized for a specific input resolution other than
    // the 640 default.
    reshape?: number;
    // Predefined class-filter groups, untrusted until parseMaloiGroups. Each is
    // { name, expr } with expr a boolean expression over 0-based positions in
    // the "classes" list, e.g. "(6 || 7) && !(1 || 2)". The legacy
    // { name, classes, join } form is still accepted (negative id = NOT).
    group?: unknown;
    // Classes to highlight in the duplicates view's per-group class resume,
    // as 0-based positions in the "classes" list (same ids as "expr"),
    // e.g. [3, 2, 1]. Untrusted until parseMaloiFocus.
    focus?: unknown;
    // The negative counterpart: classes marked as unwanted in that same
    // resume (duplicates grid and zoom), same id form, e.g. [6, 7].
    // Untrusted until parseMaloiUnfocus.
    unfocus?: unknown;
}

export interface LoadedMaloi {
    onnxPath: string;
    classNames: string[];
    groups: DetectionGroup[];
    focus: number[];
    unfocus: number[];
    reshape: number | null;
}

export const splitClassNames = (raw: string): string[] =>
    String(raw).split(",").map((s) => s.trim()).filter((s) => s.length > 0);

// Boundary validation for a .maloi's "group" array: a malformed entry is
// skipped (never throws) so a bad group can't break model loading.
export const parseMaloiGroupAst = (entry: any, classCount: number): ParseResult => {
    if (typeof entry?.expr === "string") return parseClassExpr(entry.expr, classCount);
    const join = typeof entry?.join === "string" ? entry.join.trim().toUpperCase() : "";
    const classes = entry?.classes;
    const validIds = Array.isArray(classes) && classes.length > 0
        && classes.every((id: unknown) => Number.isInteger(id) && Math.abs(id as number) < classCount);
    if (!validIds || (join !== "OR" && join !== "AND")) return { ok: false, error: "needs an \"expr\" string (or legacy \"classes\" + \"join\")" };
    return { ok: true, ast: legacyGroupToExpr(classes.map((id: number) => id || 0), join) };
};

export const parseMaloiGroups = (raw: unknown, classCount: number): DetectionGroup[] => {
    if (!Array.isArray(raw)) return [];
    const groups: DetectionGroup[] = [];
    const seen = new Set<string>();
    for (const entry of raw) {
        const name = typeof entry?.name === "string" ? entry.name.trim() : "";
        if (!name) { console.warn("[maloi] skipping group without a name"); continue; }
        if (seen.has(name)) { console.warn(`[maloi] skipping duplicate group "${name}"`); continue; }
        const parsed = parseMaloiGroupAst(entry, classCount);
        if (!parsed.ok) { console.warn(`[maloi] skipping group "${name}": ${parsed.error}`); continue; }
        seen.add(name);
        groups.push({ name, expr: formatClassExpr(parsed.ast), ast: parsed.ast });
    }
    return groups;
};

// Boundary validation for a class-id list field ("focus", "unfocus"): keeps
// integer class ids within the class list, in file order without repeats;
// anything else is skipped with a warning (never throws), like a bad group.
const parseMaloiClassIds = (field: string, raw: unknown, classCount: number): number[] => {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) { console.warn(`[maloi] ignoring "${field}": expected an array of class ids`); return []; }
    const ids: number[] = [];
    for (const id of raw) {
        if (!Number.isInteger(id) || id < 0 || id >= classCount) { console.warn(`[maloi] skipping ${field} class id ${JSON.stringify(id)}: not a class position`); continue; }
        if (!ids.includes(id)) ids.push(id);
    }
    return ids;
};

export const parseMaloiFocus = (raw: unknown, classCount: number): number[] =>
    parseMaloiClassIds("focus", raw, classCount);

// A class can't be both: an id already in "focus" is dropped from "unfocus"
// with a warning, so focus wins.
export const parseMaloiUnfocus = (raw: unknown, classCount: number, focus: number[]): number[] =>
    parseMaloiClassIds("unfocus", raw, classCount).filter((id) => {
        if (!focus.includes(id)) return true;
        console.warn(`[maloi] skipping unfocus class id ${id}: already in "focus"`);
        return false;
    });

// Letterbox/tensor size bounds for "reshape": a .maloi is now also read
// unattended (cli/lsr.ts), and a huge value means a huge tensor allocation.
export const RESHAPE_MIN = 32;
export const RESHAPE_MAX = 4096;

// A non-number "reshape" is ignored (null = the detector's default size), as
// before; a number outside an integer RESHAPE_MIN..RESHAPE_MAX is an error.
export const parseReshape = (raw: unknown, maloiPath: string): number | null => {
    if (typeof raw !== "number") return null;
    if (!Number.isInteger(raw) || raw < RESHAPE_MIN || raw > RESHAPE_MAX) {
        throw new Error(`.maloi file ${maloiPath} has an invalid "reshape" ${raw}: expected an integer from ${RESHAPE_MIN} to ${RESHAPE_MAX}`);
    }
    return raw;
};

// Pure parse of a .maloi file: the onnx path is resolved relative to the
// .maloi's own folder. Throws an Error with a clear message on unreadable
// files, bad JSON, a missing "onnx" field or an out-of-range "reshape".
export const readMaloi = (maloiPath: string): LoadedMaloi => {
    let raw: string;
    try {
        raw = fs.readFileSync(maloiPath, "utf8");
    } catch (error) {
        throw new Error(`Cannot read .maloi file ${maloiPath}: ${(error as Error).message}`);
    }
    let maloi: MaloiFile;
    try {
        maloi = JSON.parse(raw);
    } catch (error) {
        throw new Error(`Invalid JSON in .maloi file ${maloiPath}: ${(error as Error).message}`);
    }
    if (!maloi || typeof maloi !== "object" || Array.isArray(maloi)) {
        throw new Error(`.maloi file ${maloiPath} must contain a JSON object`);
    }
    if (typeof maloi.onnx !== "string" || maloi.onnx.trim() === "") {
        throw new Error(`.maloi file ${maloiPath} has no "onnx" model path`);
    }
    const classNames = splitClassNames(typeof maloi.classes === "string" ? maloi.classes : "");
    const focus = parseMaloiFocus(maloi.focus, classNames.length);
    return {
        onnxPath: path.resolve(path.dirname(maloiPath), maloi.onnx),
        classNames,
        groups: parseMaloiGroups(maloi.group, classNames.length),
        focus,
        unfocus: parseMaloiUnfocus(maloi.unfocus, classNames.length, focus),
        reshape: parseReshape(maloi.reshape, maloiPath),
    };
};

export interface MaloiDetector {
    setModelPath(newPath: string): void;
    setClassNames(names: string[]): void;
    setModelSize(size: number | null | undefined): void;
}

export interface MaloiStore {
    ensureReady(): void;
    getOrCreateModelPath(path: string): number;
    saveDetectionClasses(names: string[]): void;
    saveDetectionGroups(groups: DetectionGroup[]): void;
    saveDetectionFocus(classIds: number[]): void;
    saveDetectionUnfocus(classIds: number[]): void;
}

// Applies a parsed .maloi to the detector and persists model path, classes
// and groups to the ACTIVE folder's index.db - callers must have called
// setActiveFolder for the right root first.
export const applyMaloi = (loaded: LoadedMaloi, detector: MaloiDetector, store: MaloiStore): void => {
    store.ensureReady();
    detector.setModelPath(loaded.onnxPath);
    store.getOrCreateModelPath(loaded.onnxPath);
    store.saveDetectionClasses(loaded.classNames);
    // Replaces the saved groups; no "group" in the file clears them.
    store.saveDetectionGroups(loaded.groups);
    // Same replace semantics: no "focus" in the file clears it.
    store.saveDetectionFocus(loaded.focus);
    store.saveDetectionUnfocus(loaded.unfocus);
    detector.setClassNames(loaded.classNames);
    // Always set (even to null) rather than only when present - otherwise a
    // .maloi with no "reshape" field would silently inherit whatever override
    // an earlier .maloi pick left behind, for a model it has nothing to do with.
    detector.setModelSize(loaded.reshape);
};
