// A class filter in disjunctive normal form: the outer array is OR-ed, the
// terms inside each group are AND-ed. An empty array means "no filter".
export interface ClassFilterTerm {
    className: string
    negate: boolean
}

export type ClassFilterGroup = ClassFilterTerm[]

export type ClassFilter = ClassFilterGroup[]
