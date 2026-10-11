import { useEffect, useState } from "react"
import { IconButton } from "@mui/material"
import { KeyboardArrowLeft, KeyboardArrowRight, KeyboardDoubleArrowLeft, KeyboardDoubleArrowRight } from "@mui/icons-material"
import { Qtd } from "./gridImg.styled"

export const PER_PAGE_OPTIONS = [20, 50, 100, 200, 500, 1000]

export const totalPagesFor = (total: number, perPage: number): number => Math.ceil(total / perPage)

type PaginationProps = {
    page: number            // 0-based
    setPage: (page: number) => void
    perPage: number
    setPerPage: (qty: number) => void
    total: number           // items being paged (media for gridImg, groups for duplicatesGrid)
    perPageTitle?: string
}

// Page-size select + first/prev/page/next/last controls shared by gridImg and
// duplicatesGrid. The page number is plain text until clicked, then a
// jump-to-page field.
export const Pagination = ({ page, setPage, perPage, setPerPage, total, perPageTitle }: PaginationProps) => {

    // null = showing the page as plain text; a string = the jump-to-page field
    // is open holding that draft. One nullable value rather than a separate
    // "editing" boolean so the two can never disagree.
    const [pageDraft, setPageDraft] = useState<string | null>(null)
    // The denominator actually shown next to the page number - what "the last
    // page" means to someone reading the toolbar, so what a typed page clamps to.
    const totalPages = totalPagesFor(total, perPage)
    const lastPage = Math.max(totalPages - 1, 0)

    const openPageEditor = () => setPageDraft(String(page + 1))
    const closePageEditor = () => setPageDraft(null)

    const commitPage = () => {
        const typed = parseInt(pageDraft ?? '', 10)
        // An empty or unparseable field just closes, leaving the page alone.
        if (!isNaN(typed)) {
            // Typed pages are 1-based, page is 0-based. Out-of-range snaps to
            // the nearest end instead of being rejected.
            const clamped = Math.min(Math.max(typed, 1), Math.max(totalPages, 1))
            setPage(clamped - 1)
        }
        closePageEditor()
    }

    // The field exists only to CHANGE the page, never to display it - so any
    // other route to a new page (the arrow buttons, first/last, or the zoom
    // modal paging through into another page) puts the plain text back.
    useEffect(() => { setPageDraft(null) }, [page])

    return <>
        <select value={perPage} title={perPageTitle ?? "How many items for page"} onChange={(val) => setPerPage(parseInt(val.currentTarget.value))}>
            {PER_PAGE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <IconButton onClick={() => setPage(0)} ><KeyboardDoubleArrowLeft fontSize="small" /></IconButton>
        <IconButton onClick={() => setPage(page - 1)} disabled={page === 0} ><KeyboardArrowLeft fontSize="small" /></IconButton>
        <Qtd>
            {pageDraft === null
                ? <span
                    onClick={openPageEditor}
                    style={{ cursor: 'pointer' }}
                    title="Click to jump to a page"
                >{page + 1}</span>
                : <input
                    type="text"
                    inputMode="numeric"
                    autoFocus
                    size={3}
                    value={pageDraft}
                    title={`Type a page between 1 and ${Math.max(totalPages, 1)}, then press Enter`}
                    // Digits only: strip anything else as it is typed,
                    // rather than validating at commit, so the field can
                    // never show a value it would not accept.
                    onChange={ev => setPageDraft(ev.currentTarget.value.replace(/\D/g, ''))}
                    onFocus={ev => ev.currentTarget.select()}
                    // Clicking away abandons the jump - only Enter commits.
                    onBlur={closePageEditor}
                    // The grids' wrapping div onKeyUp is their shortcut
                    // handler ("1" toggles video controls, "q" selects
                    // all, "v"/"b" change volume...). Without this, typing
                    // a page number would fire them.
                    onKeyUp={ev => ev.stopPropagation()}
                    onKeyDown={ev => {
                        if (ev.key === 'Enter') { ev.preventDefault(); commitPage() }
                        if (ev.key === 'Escape') { ev.preventDefault(); closePageEditor() }
                    }}
                />}
            /{totalPages}
        </Qtd>
        <IconButton onClick={() => setPage(page + 1)} disabled={page >= lastPage} ><KeyboardArrowRight fontSize="small" /></IconButton>
        <IconButton onClick={() => setPage(lastPage)} ><KeyboardDoubleArrowRight fontSize="small" /></IconButton>
    </>
}
