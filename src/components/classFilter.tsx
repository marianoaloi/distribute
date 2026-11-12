import { useEffect, useState } from "react"
import { useDispatch } from "react-redux"
import {
    IconButton, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
    Button, Select, MenuItem, ListSubheader, ToggleButton, Stack, Divider, TextField, InputAdornment
} from "@mui/material"
import { FilterAlt, FilterAltOffOutlined, Add, Delete, RestartAlt, Clear } from "@mui/icons-material"
import { LoadDetectionClasses, LoadDetections, selectDetectionClassNames, selectDetectionFocus, selectDetectionGroups, selectDetectionUnfocus, useSelector } from "../lib/redux"
import { configurationsSelector, setClassFilter, setClassPresence } from "../lib/redux/slices/configurations"
import { ClassFilterBar } from "./classFilter.styled"
import { ClassExpr, ClassFilter as ClassFilterExpr, ClassFilterGroup, ClassFilterTerm, ClassPresence } from "../entity/FilterMedia"
import { DetectionGroup, MediaDetections } from "../lib/redux/slices/detections/detections.reduce"

// Evaluates a parsed .maloi expression; `has` says whether class id is present.
export function evalClassExpr(ast: ClassExpr, has: (id: number) => boolean): boolean {
    switch (ast.op) {
        case 'class': return has(ast.id)
        case 'not': return !evalClassExpr(ast.arg, has)
        case 'and': return ast.args.every(arg => evalClassExpr(arg, has))
        case 'or': return ast.args.some(arg => evalClassExpr(arg, has))
    }
}

function maxClassId(ast: ClassExpr): number {
    switch (ast.op) {
        case 'class': return ast.id
        case 'not': return maxClassId(ast.arg)
        default: return Math.max(-1, ...ast.args.map(maxClassId))
    }
}

// A group whose ids no longer fit the class list (e.g. classes were edited
// after the .maloi was picked) is stale: hidden from the Select and never
// matched, rather than evaluated against the wrong classes.
export function isStaleGroup(group: DetectionGroup, classNames: string[]): boolean {
    return maxClassId(group.ast) >= classNames.length
}

// Group name -> matcher over a media's class names; undefined when the group
// is unknown or stale.
export type GroupResolver = (groupName: string) => ((classes: string[]) => boolean) | undefined

export function groupResolver(groups: DetectionGroup[], classNames: string[]): GroupResolver {
    const byName = new Map(groups
        .filter(group => !isStaleGroup(group, classNames))
        .map(group => [group.name, group.ast] as const))
    return name => {
        const ast = byName.get(name)
        return ast && ((classes: string[]) => evalClassExpr(ast, id => classes.includes(classNames[id])))
    }
}

// Drops half-built terms (nothing picked yet) and any group left empty by
// that - a row mid-edit must never silently hide the whole grid. With a
// resolver, group terms it can't resolve (unknown/stale, e.g. persisted
// before another .maloi was picked) are dropped too, for the same reason.
export function normalizeClassFilter(filter: ClassFilterExpr, resolve?: GroupResolver): ClassFilterGroup[] {
    const keep = (term: ClassFilterTerm) => term.group
        ? !resolve || resolve(term.group) !== undefined
        : term.className !== ''
    return filter
        .map(group => group.filter(keep))
        .filter(group => group.length > 0)
}

// Does the media have a detection of the term's class satisfying its score
// condition? No score: presence only. Score N >= 0: some detection >= N/100
// (max >= t); N < 0: some detection <= |N|/100 (min <= t). Media without the
// class never matches, whatever the score.
function termHolds(term: ClassFilterTerm, detection: MediaDetections | undefined): boolean {
    if (!detection?.classes.includes(term.className)) return false
    if (term.score === null || term.score === undefined) return true
    const range = detection.classScores?.[term.className]
    if (!range) return false
    const threshold = Math.abs(term.score) / 100
    return term.score >= 0 ? range.max >= threshold : range.min <= threshold
}

// A group term holds when its expression is true over the media's classes
// (none for media without detections, so "!(1)" holds). Score is ignored. No
// matcher (unknown/stale group, or no resolver) -> doesn't hold.
function groupTermHolds(term: ClassFilterTerm, detection: MediaDetections | undefined, resolve?: GroupResolver): boolean {
    const matcher = resolve?.(term.group ?? '')
    return matcher ? matcher(detection?.classes ?? []) : false
}

// `groups` must already be normalized. `detection` carries the union of
// classes (and per-class score range) across every item linked to the media
// (all 4 video/GIF frames, not just the thumbnail one - see
// detections.reduce.ts's MediaDetections). Media with no detections fails
// every positive term and satisfies every negated one; NOT inverts the whole
// term, score condition included (for a group term: the whole expression).
export function matchesClassFilter(detection: MediaDetections | undefined, groups: ClassFilterGroup[], resolve?: GroupResolver): boolean {
    if (groups.length === 0) return true
    const holds = (term: ClassFilterTerm) => term.group ? groupTermHolds(term, detection, resolve) : termHolds(term, detection)
    return groups.some(group => group.every(term => holds(term) !== term.negate))
}

// Has the media any detected class at all? Media never run through detection
// has no entry; one run with nothing found has an empty class list.
export function hasClass(detection: MediaDetections | undefined): boolean {
    return (detection?.classes.length ?? 0) > 0
}

// Class resume of a set of items (a duplicates group, or the zoomed media):
// every class any item has, with how many of the items carry it. Items with
// no local detections (e.g. imported ones) contribute nothing. Sorted by
// count, then name.
export function classCounts(items: { id: string }[], detections: Record<string, MediaDetections>): Array<[string, number]> {
    const counts = new Map<string, number>()
    for (const item of items)
        for (const className of detections[item.id]?.classes ?? [])
            counts.set(className, (counts.get(className) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

// CSS class for a class resume line: the .maloi "focus" / "unfocus" ids,
// resolved to the names detections carry (focus wins if a name is in both).
export function useClassResumeMark(): (className: string) => "focus" | "unfocus" | undefined {
    const classNames = useSelector(selectDetectionClassNames)
    const toNames = (ids: number[]) => new Set(ids.map(id => classNames[id]).filter(Boolean))
    const focus = toNames(useSelector(selectDetectionFocus))
    const unfocus = toNames(useSelector(selectDetectionUnfocus))
    return className => focus.has(className) ? "focus" : unfocus.has(className) ? "unfocus" : undefined
}

// The "Has class / Without class" selector next to Reset. Takes the yes/no
// rather than the detection so duplicatesGrid can pass one for a whole group.
export function matchesClassPresence(withClass: boolean, presence: ClassPresence): boolean {
    return presence === '' || withClass === (presence === 'with')
}

// Select values starting with this are group picks (prefix + group name),
// never class names.
const GROUP_PREFIX = '▸group:'

const blankTerm = (): ClassFilterTerm => ({ className: '', negate: false, score: null })

// The dialog always shows at least one row, so the class Select (which also
// lists the groups) is reachable even when the filter is empty.
const withBlankRow = (filter: ClassFilterExpr): ClassFilterExpr => filter.length > 0 ? filter : [[blankTerm()]]

// Empty -> null (ignore score); anything that isn't an integer in -100..100
// is rejected (undefined) so the field keeps its previous value.
function parseScore(text: string): number | null | undefined {
    if (text.trim() === '') return null
    const n = Number(text)
    return Number.isInteger(n) && n >= -100 && n <= 100 ? n : undefined
}

export const ClassFilter = (() => {

    const dispatch = useDispatch<any>()
    const config = useSelector(configurationsSelector)
    const classNames = useSelector(selectDetectionClassNames)
    const detectionGroups = useSelector(selectDetectionGroups)
    const [open, setOpen] = useState(false)
    const [draft, setDraft] = useState<ClassFilterExpr>([])
    // The filter that was actually live (applied to the grid) at the moment
    // the dialog opened. "Try" below applies the draft live so it can be seen
    // against the grid without closing - Cancel has to put THIS back, not just
    // close the dialog, or a tried-but-uncommitted filter would silently stay
    // active.
    const [preTryFilter, setPreTryFilter] = useState<ClassFilterExpr>([])
    // Same for the Has/Without class selector, which always applies live.
    const [preTryPresence, setPreTryPresence] = useState<ClassPresence>('')
    const resolve = groupResolver(detectionGroups, classNames)
    const active = normalizeClassFilter(config.classFilter, resolve).length > 0 || config.classPresence !== ''
    const validGroups = detectionGroups.filter(group => !isStaleGroup(group, classNames))
    const validGroupNames = new Set(validGroups.map(group => group.name))
    // A row naming a group that is unknown/stale right now (groups not loaded
    // yet, or another .maloi is active) gets a disabled placeholder option, so
    // the Select shows what the row holds instead of a blank, out-of-range value.
    const unavailableGroup = (term: ClassFilterTerm) => !!term.group && !validGroupNames.has(term.group)

    // index.db is per-folder: both the class list the dropdown offers and the
    // persisted detections the filter matches against must be re-fetched every
    // time a folder finishes loading, not only on mount.
    useEffect(() => {
        if (!config.mediaLoading) {
            dispatch(LoadDetectionClasses())
            dispatch(LoadDetections())
        }
    }, [config.mediaLoading, dispatch])

    const openDialog = () => { setDraft(withBlankRow(config.classFilter)); setPreTryFilter(config.classFilter); setPreTryPresence(config.classPresence); setOpen(true) }
    // The stored (persisted) filter is normalized WITHOUT the resolver: a group
    // term that can't be resolved right now (groups not loaded yet, another
    // .maloi active) must survive Cancel/Try/Apply, not be deleted for good.
    // The grids normalize with the resolver on read, so it's ignored there.
    //
    // Discards whatever "Try" applied live and restores what was active
    // before the dialog opened - Cancel must undo Try's preview, not just
    // close the dialog on top of it.
    const closeDialog = () => { dispatch(setClassFilter(normalizeClassFilter(preTryFilter))); dispatch(setClassPresence(preTryPresence)); setOpen(false) }
    // Applies the draft to the grid immediately, same as Apply, but leaves
    // the dialog open so groups/terms can keep being edited against the
    // live result instead of round-tripping open/close/open to see it.
    const tryFilter = () => dispatch(setClassFilter(normalizeClassFilter(draft)))

    const addGroup = () => setDraft(prev => [...prev, [blankTerm()]])

    const addTerm = (groupIndex: number) => setDraft(prev =>
        prev.map((group, gi) => gi === groupIndex ? [...group, blankTerm()] : group)
    )

    const setScore = (groupIndex: number, termIndex: number, text: string) => {
        const score = parseScore(text)
        if (score === undefined) return
        setDraft(prev =>
            prev.map((group, gi) => gi === groupIndex
                ? group.map((term, ti) => ti === termIndex ? { ...term, score } : term)
                : group)
        )
    }

    // Picking a group fills only this row (it becomes a group condition, score
    // dropped); like any row edit it takes effect on Try/Apply, never on pick.
    const setClassName = (groupIndex: number, termIndex: number, picked: string) => {
        const update = (term: ClassFilterTerm): ClassFilterTerm => picked.startsWith(GROUP_PREFIX)
            ? { ...term, className: '', group: picked.slice(GROUP_PREFIX.length), score: null }
            : { ...term, className: picked, group: undefined }
        setDraft(prev =>
            prev.map((group, gi) => gi === groupIndex
                ? group.map((term, ti) => ti === termIndex ? update(term) : term)
                : group)
        )
    }

    const toggleNegate = (groupIndex: number, termIndex: number) => setDraft(prev =>
        prev.map((group, gi) => gi === groupIndex
            ? group.map((term, ti) => ti === termIndex ? { ...term, negate: !term.negate } : term)
            : group)
    )

    const removeTerm = (groupIndex: number, termIndex: number) => setDraft(prev =>
        withBlankRow(prev
            .map((group, gi) => gi === groupIndex ? group.filter((_, ti) => ti !== termIndex) : group)
            .filter(group => group.length > 0))
    )

    const removeGroup = (groupIndex: number) => setDraft(prev => withBlankRow(prev.filter((_, gi) => gi !== groupIndex)))

    // Reset takes effect immediately and leaves the dialog open, so the user sees
    // the unfiltered grid and can start a new filter without reopening.
    const reset = () => { setDraft(withBlankRow([])); dispatch(setClassFilter([])); dispatch(setClassPresence('')) }

    const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        dispatch(setClassFilter(normalizeClassFilter(draft)))
        setOpen(false)
    }

    return (
        <>
            <ClassFilterBar>
                <IconButton
                    onClick={openDialog}
                    color={active ? "primary" : "default"}
                    title={active ? "Class filter active - click to edit" : "Filter by detected class"}
                >
                    {active ? <FilterAlt fontSize="medium" /> : <FilterAltOffOutlined fontSize="medium" />}
                </IconButton>
            </ClassFilterBar>

            <Dialog
                open={open}
                onClose={closeDialog}
                maxWidth="sm"
                fullWidth
                PaperProps={{
                    component: 'form',
                    onSubmit
                }}
            >
                <DialogTitle>Filter by detected class</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        Media matches if it satisfies ANY group. Inside a group, ALL conditions must hold.
                        Score % (-100..100) is optional: 90 means a detection with score of at least 90%, -50 means one with at most 50%.
                        A group (▸) is one condition: NOT inverts its whole expression, and Score % does not apply to it.
                    </DialogContentText>
                    {classNames.length === 0 &&
                        <DialogContentText>
                            No detection classes yet - set the class names and run detection first.
                        </DialogContentText>
                    }
                    {draft.map((group, gi) => (
                        <div key={gi}>
                            {gi > 0 && <Divider>OR</Divider>}
                            {group.map((term, ti) => (
                                <Stack key={ti} direction="row" spacing={1} alignItems="center" sx={{ my: 1 }}>
                                    {ti > 0 && <span>AND</span>}
                                    <ToggleButton
                                        size="small"
                                        value="not"
                                        selected={term.negate}
                                        onChange={() => toggleNegate(gi, ti)}
                                    >
                                        NOT
                                    </ToggleButton>
                                    <Select
                                        size="small"
                                        displayEmpty
                                        value={term.group ? GROUP_PREFIX + term.group : term.className}
                                        onChange={(e) => setClassName(gi, ti, e.target.value)}
                                        sx={{ minWidth: 180 }}
                                    >
                                        <MenuItem value=""><em>Choose a class</em></MenuItem>
                                        {classNames.map(n => <MenuItem key={n} value={n}>{n}</MenuItem>)}
                                        {(validGroups.length > 0 || unavailableGroup(term)) && <ListSubheader>Groups</ListSubheader>}
                                        {validGroups.map(g => <MenuItem key={g.name} value={GROUP_PREFIX + g.name} title={g.expr}>{'▸ ' + g.name}</MenuItem>)}
                                        {unavailableGroup(term) &&
                                            <MenuItem value={GROUP_PREFIX + term.group} disabled
                                                title="This group isn't in the current .maloi (or its classes changed) - the condition is ignored">
                                                {'▸ ' + term.group + ' (unavailable)'}
                                            </MenuItem>}
                                    </Select>
                                    <TextField
                                        size="small"
                                        type="number"
                                        label="Score %"
                                        title={term.group
                                            ? "Score does not apply to a group."
                                            : "+N: some detection with score >= N%. -N: some detection with score <= N%. Empty: any score."}
                                        disabled={!!term.group}
                                        value={term.score ?? ''}
                                        onChange={(e) => setScore(gi, ti, e.target.value)}
                                        slotProps={{
                                            htmlInput: { min: -100, max: 100, step: 1 },
                                            input: {
                                                endAdornment: !term.group && term.score !== null && term.score !== undefined &&
                                                    <InputAdornment position="end">
                                                        <IconButton type="button" size="small" edge="end"
                                                            onClick={() => setScore(gi, ti, '')} title="Clear score (any score)">
                                                            <Clear fontSize="small" />
                                                        </IconButton>
                                                    </InputAdornment>
                                            }
                                        }}
                                        sx={{ width: 130 }}
                                    />
                                    <IconButton type="button" onClick={() => removeTerm(gi, ti)} title="Remove condition">
                                        <Delete fontSize="small" />
                                    </IconButton>
                                </Stack>
                            ))}
                            <Button type="button" size="small" startIcon={<Add />} onClick={() => addTerm(gi)}>
                                AND condition
                            </Button>
                            <Button type="button" size="small" color="error" startIcon={<Delete />} onClick={() => removeGroup(gi)}>
                                Remove group
                            </Button>
                        </div>
                    ))}
                    <div>
                        <Button type="button" startIcon={<Add />} onClick={addGroup}>OR group</Button>
                    </div>
                </DialogContent>
                <DialogActions>
                    <Button type="button" startIcon={<RestartAlt />} onClick={reset}>Reset</Button>
                    <TextField
                        select
                        size="small"
                        label="Media"
                        title="Only media with at least one detected class, or only media with none. Applies right away."
                        value={config.classPresence}
                        onChange={(e) => dispatch(setClassPresence(e.target.value as ClassPresence))}
                        sx={{ minWidth: 160 }}
                    >
                        <MenuItem value=""><em>All</em></MenuItem>
                        <MenuItem value="with">Has class</MenuItem>
                        <MenuItem value="without">Without class</MenuItem>
                    </TextField>
                    <div style={{ flex: 1 }} />
                    <Button type="button" onClick={closeDialog}>Cancel</Button>
                    <Button type="button" onClick={tryFilter}>Try</Button>
                    <Button type="submit">Apply</Button>
                </DialogActions>
            </Dialog>
        </>
    )
})
