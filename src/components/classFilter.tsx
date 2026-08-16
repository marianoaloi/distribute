import { useEffect, useState } from "react"
import { useDispatch } from "react-redux"
import {
    IconButton, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
    Button, Select, MenuItem, ToggleButton, Stack, Divider
} from "@mui/material"
import { FilterAlt, Add, Delete, RestartAlt } from "@mui/icons-material"
import { LoadDetectionClasses, LoadDetections, selectDetectionClassNames, useSelector } from "../lib/redux"
import { configurationsSelector, setClassFilter } from "../lib/redux/slices/configurations"
import { ClassFilterBar } from "./classFilter.styled"
import { ClassFilter as ClassFilterExpr, ClassFilterGroup } from "../entity/FilterMedia"
import { DetectionBox } from "../lib/redux/slices/detections/detections.reduce"

// Drops half-built terms (no class picked yet) and any group left empty by
// that - a row mid-edit must never silently hide the whole grid.
export function normalizeClassFilter(filter: ClassFilterExpr): ClassFilterGroup[] {
    return filter
        .map(group => group.filter(term => term.className !== ''))
        .filter(group => group.length > 0)
}

// `groups` must already be normalized. Media with no detections has an empty
// class set, so it fails every positive term and satisfies every negated one.
export function matchesClassFilter(boxes: DetectionBox[] | undefined, groups: ClassFilterGroup[]): boolean {
    if (groups.length === 0) return true
    const present = new Set((boxes ?? []).map(box => box.className))
    return groups.some(group => group.every(term =>
        term.negate ? !present.has(term.className) : present.has(term.className)
    ))
}

export const ClassFilter = (() => {

    const dispatch = useDispatch<any>()
    const config = useSelector(configurationsSelector)
    const classNames = useSelector(selectDetectionClassNames)
    const [open, setOpen] = useState(false)
    const [draft, setDraft] = useState<ClassFilterExpr>([])
    const active = normalizeClassFilter(config.classFilter).length > 0

    // index.db is per-folder: both the class list the dropdown offers and the
    // persisted detections the filter matches against must be re-fetched every
    // time a folder finishes loading, not only on mount.
    useEffect(() => {
        if (!config.mediaLoading) {
            dispatch(LoadDetectionClasses())
            dispatch(LoadDetections())
        }
    }, [config.mediaLoading, dispatch])

    const openDialog = () => { setDraft(config.classFilter); setOpen(true) }
    const closeDialog = () => setOpen(false)

    const addGroup = () => setDraft(prev => [...prev, [{ className: '', negate: false }]])

    const addTerm = (groupIndex: number) => setDraft(prev =>
        prev.map((group, gi) => gi === groupIndex ? [...group, { className: '', negate: false }] : group)
    )

    const setClassName = (groupIndex: number, termIndex: number, className: string) => setDraft(prev =>
        prev.map((group, gi) => gi === groupIndex
            ? group.map((term, ti) => ti === termIndex ? { ...term, className } : term)
            : group)
    )

    const toggleNegate = (groupIndex: number, termIndex: number) => setDraft(prev =>
        prev.map((group, gi) => gi === groupIndex
            ? group.map((term, ti) => ti === termIndex ? { ...term, negate: !term.negate } : term)
            : group)
    )

    const removeTerm = (groupIndex: number, termIndex: number) => setDraft(prev =>
        prev
            .map((group, gi) => gi === groupIndex ? group.filter((_, ti) => ti !== termIndex) : group)
            .filter(group => group.length > 0)
    )

    const removeGroup = (groupIndex: number) => setDraft(prev => prev.filter((_, gi) => gi !== groupIndex))

    // Reset takes effect immediately and leaves the dialog open, so the user sees
    // the unfiltered grid and can start a new filter without reopening.
    const reset = () => { setDraft([]); dispatch(setClassFilter([])) }

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
                    <FilterAlt fontSize="medium" />
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
                                    </Select>
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
                    <Button type="submit">Apply</Button>
                </DialogActions>
            </Dialog>
        </>
    )
})
