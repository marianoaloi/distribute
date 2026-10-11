import { useEffect, useState } from "react"
import { useDispatch } from "react-redux"
import {
    IconButton, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
    Button, Select, MenuItem, ListSubheader, ToggleButton, Stack, Divider, TextField
} from "@mui/material"
import { FilterAlt, FilterAltOffOutlined, Add, Delete, RestartAlt } from "@mui/icons-material"
import { LoadDetectionClasses, LoadDetections, selectDetectionClassNames, selectDetectionGroups, useSelector } from "../lib/redux"
import { configurationsSelector, setClassFilter } from "../lib/redux/slices/configurations"
import { ClassFilterBar } from "./classFilter.styled"
import { ClassFilter as ClassFilterExpr, ClassFilterGroup, ClassFilterTerm } from "../entity/FilterMedia"
import { DetectionGroup, MediaDetections } from "../lib/redux/slices/detections/detections.reduce"

// Drops half-built terms (no class picked yet) and any group left empty by
// that - a row mid-edit must never silently hide the whole grid.
export function normalizeClassFilter(filter: ClassFilterExpr): ClassFilterGroup[] {
    return filter
        .map(group => group.filter(term => term.className !== ''))
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

// `groups` must already be normalized. `detection` carries the union of
// classes (and per-class score range) across every item linked to the media
// (all 4 video/GIF frames, not just the thumbnail one - see
// detections.reduce.ts's MediaDetections). Media with no detections fails
// every positive term and satisfies every negated one; NOT inverts the whole
// term, score condition included.
export function matchesClassFilter(detection: MediaDetections | undefined, groups: ClassFilterGroup[]): boolean {
    if (groups.length === 0) return true
    return groups.some(group => group.every(term => termHolds(term, detection) !== term.negate))
}

// Select values starting with this are group picks, never class names.
const GROUP_PREFIX = '▸group:'

const blankTerm = (): ClassFilterTerm => ({ className: '', negate: false, score: null })

// The dialog always shows at least one row, so the class Select (which also
// lists the groups) is reachable even when the filter is empty.
const withBlankRow = (filter: ClassFilterExpr): ClassFilterExpr => filter.length > 0 ? filter : [[blankTerm()]]

// Group -> filter expression: OR = one single-term group per class (groups are
// ORed), AND = one group holding every term. Negative id = NOT that class.
// Null when an id no longer fits the class list (e.g. classes were edited
// after the .maloi was picked), so a stale group is hidden, not misapplied.
function groupToFilter(group: DetectionGroup, classNames: string[]): ClassFilterExpr | null {
    if (group.classes.some(id => Math.abs(id) >= classNames.length)) return null
    const terms = group.classes.map((id): ClassFilterTerm => ({ className: classNames[Math.abs(id)], negate: id < 0, score: null }))
    return group.join === 'AND' ? [terms] : terms.map(term => [term])
}

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
    const active = normalizeClassFilter(config.classFilter).length > 0
    const groupFilters = detectionGroups
        .map((group, index) => ({ index, name: group.name, filter: groupToFilter(group, classNames) }))
        .filter(g => g.filter !== null)

    // index.db is per-folder: both the class list the dropdown offers and the
    // persisted detections the filter matches against must be re-fetched every
    // time a folder finishes loading, not only on mount.
    useEffect(() => {
        if (!config.mediaLoading) {
            dispatch(LoadDetectionClasses())
            dispatch(LoadDetections())
        }
    }, [config.mediaLoading, dispatch])

    const openDialog = () => { setDraft(withBlankRow(config.classFilter)); setPreTryFilter(config.classFilter); setOpen(true) }
    // Discards whatever "Try" applied live and restores what was active
    // before the dialog opened - Cancel must undo Try's preview, not just
    // close the dialog on top of it.
    const closeDialog = () => { dispatch(setClassFilter(normalizeClassFilter(preTryFilter))); setOpen(false) }
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

    // Picking a group replaces the whole filter with its expression and applies
    // it right away (dialog stays open for tweaking); it is never stored as a
    // term's className.
    const applyGroup = (index: number) => {
        const filter = groupFilters.find(g => g.index === index)?.filter
        if (!filter) return
        setDraft(filter)
        dispatch(setClassFilter(normalizeClassFilter(filter)))
    }

    const setClassName = (groupIndex: number, termIndex: number, className: string) => {
        if (className.startsWith(GROUP_PREFIX)) return applyGroup(Number(className.slice(GROUP_PREFIX.length)))
        setDraft(prev =>
            prev.map((group, gi) => gi === groupIndex
                ? group.map((term, ti) => ti === termIndex ? { ...term, className } : term)
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
    const reset = () => { setDraft(withBlankRow([])); dispatch(setClassFilter([])) }

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
                                        value={term.className}
                                        onChange={(e) => setClassName(gi, ti, e.target.value)}
                                        sx={{ minWidth: 180 }}
                                    >
                                        <MenuItem value=""><em>Choose a class</em></MenuItem>
                                        {classNames.map(n => <MenuItem key={n} value={n}>{n}</MenuItem>)}
                                        {groupFilters.length > 0 && <ListSubheader>Groups</ListSubheader>}
                                        {groupFilters.map(g => <MenuItem key={GROUP_PREFIX + g.index} value={GROUP_PREFIX + g.index}>{'▸ ' + g.name}</MenuItem>)}
                                    </Select>
                                    <TextField
                                        size="small"
                                        type="number"
                                        label="Score %"
                                        title="+N: some detection with score >= N%. -N: some detection with score <= N%. Empty: any score."
                                        value={term.score ?? ''}
                                        onChange={(e) => setScore(gi, ti, e.target.value)}
                                        inputProps={{ min: -100, max: 100, step: 1 }}
                                        sx={{ width: 100 }}
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
                    <div style={{ flex: 1 }} />
                    <Button type="button" onClick={closeDialog}>Cancel</Button>
                    <Button type="button" onClick={tryFilter}>Try</Button>
                    <Button type="submit">Apply</Button>
                </DialogActions>
            </Dialog>
        </>
    )
})
