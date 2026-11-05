// A class filter in disjunctive normal form: the outer array is OR-ed, the
// terms inside each group are AND-ed. An empty array means "no filter".
export interface ClassFilterTerm {
    // Empty when `group` is set.
    className: string
    // Name of a .maloi group used as a single condition (its expression is
    // evaluated against the media's classes). Stored by name, not by index or
    // expansion, so the filter survives a reload; a name that no longer
    // resolves (another .maloi picked) is dropped on normalization.
    group?: string
    negate: boolean
    // Optional score threshold as the raw integer the user typed, -100..100
    // (percent; the matcher divides by 100). N >= 0: some detection of the
    // class with score >= N/100. N < 0: some detection with score <= |N|/100.
    // null/undefined ignores score (class presence only) - also what filters
    // created before this field existed look like. Ignored on group terms.
    score?: number | null
}

// Boolean expression over classes, already parsed by the main process from
// the .maloi text (the renderer only evaluates it, never parses). id is a
// 0-based index into the classNames list.
export type ClassExpr =
    | { op: 'class'; id: number }
    | { op: 'not'; arg: ClassExpr }
    | { op: 'and'; args: ClassExpr[] }
    | { op: 'or'; args: ClassExpr[] }

export type ClassFilterGroup = ClassFilterTerm[]

export type ClassFilter = ClassFilterGroup[]

// Coarse companion of ClassFilter, ANDed with it: '' = no filter, 'with' =
// media with at least one detected class, 'without' = media with none (never
// run through detection, or run with nothing found).
export type ClassPresence = '' | 'with' | 'without'
