// A class filter in disjunctive normal form: the outer array is OR-ed, the
// terms inside each group are AND-ed. An empty array means "no filter".
export interface ClassFilterTerm {
    className: string
    negate: boolean
    // Optional score threshold as the raw integer the user typed, -100..100
    // (percent; the matcher divides by 100). N >= 0: some detection of the
    // class with score >= N/100. N < 0: some detection with score <= |N|/100.
    // null/undefined ignores score (class presence only) - also what filters
    // created before this field existed look like.
    score?: number | null
}

export type ClassFilterGroup = ClassFilterTerm[]

export type ClassFilter = ClassFilterGroup[]

// Coarse companion of ClassFilter, ANDed with it: '' = no filter, 'with' =
// media with at least one detected class, 'without' = media with none (never
// run through detection, or run with nothing found).
export type ClassPresence = '' | 'with' | 'without'
