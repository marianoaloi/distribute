// The parser lives with the main process (mediaDb/) but is pure and
// import-free; CRA's jest transforms TS outside src/ too, so it is tested
// from here rather than needing a separate jest setup for mediaDb.
import { ClassExpr, formatClassExpr, legacyGroupToExpr, parseClassExpr } from "../../mediaDb/classExpr"

const c = (id: number): ClassExpr => ({ op: "class", id })
const not = (arg: ClassExpr): ClassExpr => ({ op: "not", arg })
const and = (...args: ClassExpr[]): ClassExpr => ({ op: "and", args })
const or = (...args: ClassExpr[]): ClassExpr => ({ op: "or", args })

// Parses and fails the test (with the parser's message) if it doesn't parse.
const ast = (text: string, classCount = 10): ClassExpr => {
    const result = parseClassExpr(text, classCount)
    if (!result.ok) throw new Error(`expected "${text}" to parse, got: ${result.error}`)
    return result.ast
}

// Parses and fails the test if it DOES parse; returns the error message.
const error = (text: string, classCount = 10): string => {
    const result = parseClassExpr(text, classCount)
    if (result.ok) throw new Error(`expected "${text}" to fail, got: ${JSON.stringify(result.ast)}`)
    return result.error
}

describe("parseClassExpr - the user's example", () => {
    const text = "(6 || 7 || 8 || 9) && !(1 || 2 || 3)"

    it("builds the exact AST", () => {
        expect(ast(text)).toEqual(and(or(c(6), c(7), c(8), c(9)), not(or(c(1), c(2), c(3)))))
    })

    it("formats back to the same canonical text", () => {
        expect(formatClassExpr(ast(text))).toBe(text)
    })
})

describe("parseClassExpr - keywords", () => {
    it("accepts or/and/not in any case, same AST as the symbols", () => {
        const expected = or(c(6), and(c(7), not(c(1))))
        expect(ast("6 or 7 and not 1")).toEqual(expected)
        expect(ast("6 OR 7 AND NOT 1")).toEqual(expected)
        expect(ast("6 Or 7 aNd NoT 1")).toEqual(expected)
        expect(ast("6 || 7 && !1")).toEqual(expected)
    })

    it("mixes keywords and symbols", () => {
        expect(ast("(1 OR 2) && not 3 || !4 and 5")).toEqual(or(and(or(c(1), c(2)), not(c(3))), and(not(c(4)), c(5))))
    })

    it("formats keywords as symbols", () => {
        expect(formatClassExpr(ast("6 Or 7 aNd NoT 1"))).toBe("6 || 7 && !1")
    })
})

describe("parseClassExpr - precedence (not > and > or)", () => {
    it("1 || 2 && 3 is or(1, and(2, 3))", () => {
        expect(ast("1 || 2 && 3")).toEqual(or(c(1), and(c(2), c(3))))
    })

    it("1 && 2 || 3 is or(and(1, 2), 3)", () => {
        expect(ast("1 && 2 || 3")).toEqual(or(and(c(1), c(2)), c(3)))
    })

    it("!1 && 2 is and(not 1, 2)", () => {
        expect(ast("!1 && 2")).toEqual(and(not(c(1)), c(2)))
    })

    it("! applies to a parenthesized group as a whole", () => {
        expect(ast("!(1 && 2)")).toEqual(not(and(c(1), c(2))))
    })

    it("stacks nots", () => {
        expect(ast("!!1")).toEqual(not(not(c(1))))
        expect(ast("not !not 1")).toEqual(not(not(not(c(1)))))
    })
})

describe("parseClassExpr - flattening", () => {
    it("1 || (2 || 3) is or(1, 2, 3)", () => {
        expect(ast("1 || (2 || 3)")).toEqual(or(c(1), c(2), c(3)))
    })

    it("(1 && 2) && 3 is and(1, 2, 3)", () => {
        expect(ast("(1 && 2) && 3")).toEqual(and(c(1), c(2), c(3)))
        expect(ast("1 && (2 && (3 && 4))")).toEqual(and(c(1), c(2), c(3), c(4)))
    })

    it("does not merge different operators", () => {
        expect(ast("1 || (2 && 3)")).toEqual(or(c(1), and(c(2), c(3))))
        expect(ast("1 && (2 || 3)")).toEqual(and(c(1), or(c(2), c(3))))
    })

    it("does not merge through a not", () => {
        expect(ast("1 || !(2 || 3)")).toEqual(or(c(1), not(or(c(2), c(3)))))
    })

    it("a single id is a bare class node, not a one-arg or/and", () => {
        expect(ast("4")).toEqual(c(4))
        expect(ast("((4))")).toEqual(c(4))
    })
})

describe("parseClassExpr - parens and whitespace", () => {
    it("ignores redundant parens", () => {
        expect(ast("((1))")).toEqual(c(1))
        expect(ast("((1 || 2))")).toEqual(or(c(1), c(2)))
    })

    it("handles nesting", () => {
        expect(ast("!((1 && (2 || !3)))")).toEqual(not(and(c(1), or(c(2), not(c(3))))))
        expect(ast("(1 || (2 && (3 || (4 && 5))))")).toEqual(or(c(1), and(c(2), or(c(3), and(c(4), c(5))))))
    })

    it("ignores spaces, tabs and newlines, and needs none", () => {
        expect(ast("  ( ( 1||2 ) &&\t3 )\n")).toEqual(and(or(c(1), c(2)), c(3)))
        expect(ast("(6||7)&&!(1||2)")).toEqual(and(or(c(6), c(7)), not(or(c(1), c(2)))))
    })

    it("accepts class 0 and leading zeros", () => {
        expect(ast("0")).toEqual(c(0))
        expect(ast("007 || 0")).toEqual(or(c(7), c(0)))
    })

    it("accepts moderate nesting but rejects absurd nesting instead of overflowing", () => {
        expect(ast("(".repeat(50) + "1" + ")".repeat(50))).toEqual(c(1))
        expect(error("(".repeat(5000) + "1" + ")".repeat(5000))).toMatch(/nested too deeply/)
        expect(error("!".repeat(5000) + "1")).toMatch(/nested too deeply/)
    })
})

describe("parseClassExpr - errors", () => {
    it("empty or blank text", () => {
        expect(error("")).toMatch(/empty/)
        expect(error("   ")).toMatch(/empty/)
        expect(error("\t\n")).toMatch(/empty/)
    })

    it("unclosed paren", () => {
        expect(error("(1 || 2")).toMatch(/end of expression/)
    })

    it("dangling operator", () => {
        expect(error("1 ||")).toMatch(/end of expression/)
        expect(error("1 && !")).toMatch(/end of expression/)
    })

    it("two ids with no operator, with the 0-based position of the second", () => {
        expect(error("1 2")).toMatch(/'2' at 2/)
    })

    it("negative ids are not ids", () => {
        expect(error("-1")).toMatch(/'-' at 0/)
        expect(error("1 || -2")).toMatch(/'-' at 5/)
    })

    it("single | or & is not an operator", () => {
        expect(error("1 | 2")).toMatch(/'\|' at 2/)
        expect(error("1 & 2")).toMatch(/'&' at 2/)
    })

    it("unknown words", () => {
        expect(error("abc")).toMatch(/'abc' at 0/)
        expect(error("1 xor 2")).toMatch(/'xor' at 2/)
    })

    it("misplaced tokens", () => {
        expect(error(")")).toMatch(/'\)' at 0/)
        expect(error("1)")).toMatch(/'\)' at 1/)
        expect(error("()")).toMatch(/'\)' at 1/)
        expect(error("1 && && 2")).toMatch(/'&&' at 5/)
        expect(error("|| 1")).toMatch(/'\|\|' at 0/)
        expect(error("1 !2")).toMatch(/'!' at 2/)
    })

    it("id out of range for the class count, with its position", () => {
        expect(error("10", 10)).toMatch(/10 out of range.* at 0/)
        expect(error("3 || 10", 10)).toMatch(/10 out of range.* at 5/)
        expect(ast("9", 10)).toEqual(c(9))
        expect(error("0", 0)).toMatch(/out of range/)
    })

    it("Infinity class count skips the range check", () => {
        expect(ast("123456789 || 1000", Infinity)).toEqual(or(c(123456789), c(1000)))
    })

    it("ids too large for a safe integer are rejected even with Infinity", () => {
        expect(error("99999999999999999999", Infinity)).toMatch(/too large.* at 0/)
    })
})

describe("formatClassExpr", () => {
    it("uses ||, && and ! with spaces around binary ops and minimal parens", () => {
        expect(formatClassExpr(ast("1||2&&3"))).toBe("1 || 2 && 3")
        expect(formatClassExpr(ast("(1||2)&&3"))).toBe("(1 || 2) && 3")
        expect(formatClassExpr(ast("((1 || 2))"))).toBe("1 || 2")
        expect(formatClassExpr(ast("!(1)"))).toBe("!1")
        expect(formatClassExpr(ast("!(1 && 2)"))).toBe("!(1 && 2)")
        expect(formatClassExpr(ast("!(!1)"))).toBe("!!1")
        expect(formatClassExpr(ast("(1 && 2) || (3 && !4)"))).toBe("1 && 2 || 3 && !4")
    })

    it("formats hand-built ASTs", () => {
        expect(formatClassExpr(c(0))).toBe("0")
        expect(formatClassExpr(not(or(c(1), c(2))))).toBe("!(1 || 2)")
        expect(formatClassExpr(and(or(c(1), c(2)), or(c(3), c(4))))).toBe("(1 || 2) && (3 || 4)")
    })

    it("parse(format(x)) round-trips and format is idempotent", () => {
        const samples = [
            "(6 || 7 || 8 || 9) && !(1 || 2 || 3)",
            "0",
            "!!1",
            "!(1 && 2)",
            "1 || 2 && 3",
            "(1 || 2) && (3 || !4)",
            "1 && (2 || 3 && !(4 || 5))",
            "not (1 or not (2 and 3)) and 4",
            "((((1)))) || ((2 && 3) && 4)",
        ]
        for (const text of samples) {
            const parsed = ast(text)
            const formatted = formatClassExpr(parsed)
            expect(ast(formatted)).toEqual(parsed)
            expect(formatClassExpr(ast(formatted))).toBe(formatted)
        }
    })
})

describe("legacyGroupToExpr", () => {
    it("OR joins every id", () => {
        expect(legacyGroupToExpr([1, 2, 3], "OR")).toEqual(or(c(1), c(2), c(3)))
    })

    it("AND joins every id", () => {
        expect(legacyGroupToExpr([1, 2], "AND")).toEqual(and(c(1), c(2)))
    })

    it("negative id means NOT that class", () => {
        expect(legacyGroupToExpr([1, -2], "AND")).toEqual(and(c(1), not(c(2))))
        expect(legacyGroupToExpr([-4], "OR")).toEqual(not(c(4)))
    })

    it("id 0 stays class 0", () => {
        expect(legacyGroupToExpr([0, -3], "OR")).toEqual(or(c(0), not(c(3))))
        expect(legacyGroupToExpr([0], "AND")).toEqual(c(0))
    })

    it("a single id is a bare class node", () => {
        expect(legacyGroupToExpr([5], "OR")).toEqual(c(5))
        expect(legacyGroupToExpr([5], "AND")).toEqual(c(5))
    })

    it("formats to the equivalent expression text", () => {
        expect(formatClassExpr(legacyGroupToExpr([6, 7, -1], "AND"))).toBe("6 && 7 && !1")
        expect(formatClassExpr(legacyGroupToExpr([6, -1], "OR"))).toBe("6 || !1")
    })
})
