// Boolean expressions over detection class ids, used by the .maloi "group"
// entries. Pure and import-free on purpose: the renderer keeps a copy of the
// ClassExpr type (it can't import outside src/), and mediaSchema.ts needs this
// file without any dependency cycle. The main process parses the text once and
// ships the AST, so the renderer only ever evaluates, never parses.

export type ClassExpr =
    | { op: "class"; id: number }
    | { op: "not"; arg: ClassExpr }
    | { op: "and"; args: ClassExpr[] }
    | { op: "or"; args: ClassExpr[] };

export type ParseResult = { ok: true; ast: ClassExpr } | { ok: false; error: string };

type Token =
    | { kind: "int"; value: number; pos: number }
    | { kind: "or" | "and" | "not" | "(" | ")"; pos: number };

// Hostile or accidental "((((...": recursion would blow the stack.
const MAX_DEPTH = 100;

class ParseError extends Error {}

const WORD_KINDS: Record<string, "or" | "and" | "not"> = { or: "or", and: "and", not: "not" };

const tokenize = (text: string): Token[] => {
    const tokens: Token[] = [];
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (/\s/.test(ch)) { i++; continue; }
        if (ch === "(" || ch === ")") { tokens.push({ kind: ch, pos: i }); i++; continue; }
        if (ch === "!") { tokens.push({ kind: "not", pos: i }); i++; continue; }
        if (text.startsWith("||", i)) { tokens.push({ kind: "or", pos: i }); i += 2; continue; }
        if (text.startsWith("&&", i)) { tokens.push({ kind: "and", pos: i }); i += 2; continue; }
        const digits = /^\d+/.exec(text.slice(i));
        if (digits) {
            const value = Number(digits[0]);
            if (!Number.isSafeInteger(value)) throw new ParseError(`class id ${digits[0]} too large at ${i}`);
            tokens.push({ kind: "int", value, pos: i });
            i += digits[0].length;
            continue;
        }
        const word = /^[A-Za-z]+/.exec(text.slice(i));
        const kind = word ? WORD_KINDS[word[0].toLowerCase()] : undefined;
        if (word && kind) { tokens.push({ kind, pos: i }); i += word[0].length; continue; }
        throw new ParseError(`unexpected '${word ? word[0] : ch}' at ${i}`);
    }
    return tokens;
};

const describe = (t: Token): string => (t.kind === "int" ? String(t.value) : t.kind === "or" ? "||" : t.kind === "and" ? "&&" : t.kind === "not" ? "!" : t.kind);

// Splices same-op children so the AST is always flattened.
const combine = (op: "and" | "or", args: ClassExpr[]): ClassExpr => {
    if (args.length === 1) return args[0];
    const flat = args.flatMap((a) => (a.op === op ? a.args : [a]));
    return { op, args: flat } as ClassExpr;
};

const parseTokens = (tokens: Token[], classCount: number, end: number): ClassExpr => {
    let idx = 0;
    const peek = (): Token | undefined => tokens[idx];

    const parseBinary = (op: "or" | "and", next: (d: number) => ClassExpr, depth: number): ClassExpr => {
        const args = [next(depth)];
        while (peek()?.kind === op) { idx++; args.push(next(depth)); }
        return combine(op, args);
    };

    const parseAtom = (depth: number): ClassExpr => {
        const t = peek();
        if (!t) throw new ParseError(`unexpected end of expression at ${end}`);
        idx++;
        if (t.kind === "int") {
            if (t.value >= classCount) throw new ParseError(`class id ${t.value} out of range (${classCount} classes) at ${t.pos}`);
            return { op: "class", id: t.value };
        }
        if (t.kind === "(") {
            const inner = parseOr(depth + 1);
            const close = peek();
            if (!close) throw new ParseError(`unexpected end of expression at ${end}`);
            if (close.kind !== ")") throw new ParseError(`unexpected '${describe(close)}' at ${close.pos}`);
            idx++;
            return inner;
        }
        throw new ParseError(`unexpected '${describe(t)}' at ${t.pos}`);
    };

    const parseNot = (depth: number): ClassExpr => {
        if (depth > MAX_DEPTH) throw new ParseError("expression nested too deeply");
        if (peek()?.kind === "not") { idx++; return { op: "not", arg: parseNot(depth + 1) }; }
        return parseAtom(depth);
    };

    const parseAnd = (depth: number): ClassExpr => parseBinary("and", parseNot, depth);
    const parseOr = (depth: number): ClassExpr => parseBinary("or", parseAnd, depth);

    const ast = parseOr(0);
    const extra = peek();
    if (extra) throw new ParseError(`unexpected '${describe(extra)}' at ${extra.pos}`);
    return ast;
};

// classCount = Infinity skips the range check (used when re-reading stored
// text whose class list may have changed since it was validated).
export const parseClassExpr = (text: string, classCount: number): ParseResult => {
    try {
        const tokens = tokenize(String(text));
        if (tokens.length === 0) return { ok: false, error: "empty expression" };
        return { ok: true, ast: parseTokens(tokens, classCount, String(text).length) };
    } catch (e) {
        if (e instanceof ParseError) return { ok: false, error: e.message };
        throw e;
    }
};

// Binding strength: or < and < not/class.
const precedence = (e: ClassExpr): number => (e.op === "or" ? 1 : e.op === "and" ? 2 : 3);

const formatChild = (e: ClassExpr, minPrec: number): string => {
    const text = formatClassExpr(e);
    return precedence(e) < minPrec ? `(${text})` : text;
};

// Canonical text; parseClassExpr(formatClassExpr(ast)) yields the same ast.
export const formatClassExpr = (ast: ClassExpr): string => {
    switch (ast.op) {
        case "class": return String(ast.id);
        case "not": return `!${formatChild(ast.arg, 3)}`;
        case "and": return ast.args.map((a) => formatChild(a, 2)).join(" && ");
        case "or": return ast.args.map((a) => formatChild(a, 1)).join(" || ");
    }
};

// Old {classes, join} groups: negative id = NOT, a bare 0 stays class 0.
export const legacyGroupToExpr = (classes: number[], join: "OR" | "AND"): ClassExpr => {
    const nodes: ClassExpr[] = classes.map((id) => (id < 0 ? { op: "not", arg: { op: "class", id: -id } } : { op: "class", id }));
    return combine(join === "AND" ? "and" : "or", nodes);
};
