import { KeyboardEvent, useRef, useState } from "react"
import { useDispatch } from "react-redux"
import { IconButton, CircularProgress, LinearProgress } from "@mui/material"
import { Refresh, ImageSearch, RestartAlt, FolderOpen, FolderCopyTwoTone, VolumeOff, FileDownload, FileUpload, RadioButtonChecked, RadioButtonUnchecked } from "@mui/icons-material"
import { Media } from "../entity/Media"
import { ExportDatabase, FindDuplicates, FindIndexDuplicates, ImportDatabase, OpenDirectory, OpenDirectoryRecursive, RebuildIndex, indexRebuildFinished, selectDbExportError, selectDbExporting, selectDbImportError, selectDbImporting, selectDbImportMatched, selectDuplicateGroups, selectIndexRebuildError, selectIndexRebuilding, selectIndexRebuildProgress, selectMedias, updateManyArrayItem, useSelector } from "../lib/redux"
import { configurationsSelector } from "../lib/redux/slices/configurations"
import { MediaIMG } from "./media"
import ModalZoom from "./modalZoom"
import { CounterImgIndex, DuplicateGroupCard, DuplicateGroupRow, DuplicatesList, DuplicatesResume, EmptyState, GroupLabel, ImportedMediaWrap, RebuildIndexInfo } from "./duplicatesGrid.styled"
import { Folders } from "./folder"
import { MediaTypeFilter, matchesMediaType } from "./mediaTypeFilter"

export const GridDuplicates = (() => {

    const dispatch = useDispatch<any>();

    const config = useSelector(configurationsSelector)
    const medias = useSelector(selectMedias).filter(m => !m.deleted)
        .filter(m => matchesMediaType(m.mime, config.mediaType))
    const groupIds = useSelector(selectDuplicateGroups)
    const indexRebuilding = useSelector(selectIndexRebuilding)
    const indexRebuildError = useSelector(selectIndexRebuildError)
    const indexRebuildProgress = useSelector(selectIndexRebuildProgress)
    const dbExporting = useSelector(selectDbExporting)
    const dbExportError = useSelector(selectDbExportError)
    const dbImporting = useSelector(selectDbImporting)
    const dbImportError = useSelector(selectDbImportError)
    const dbImportMatched = useSelector(selectDbImportMatched)

    const mediaById = new Map(medias.map(m => [m.id, m]))

    let counterIndex = 0
    const groups: Media[][] = groupIds
        .map(ids => ids.map(id => mediaById.get(id)).filter((m): m is Media => !!m))
        .filter(group => group.length > 1)
        .map(group => [...group].sort((a, b) => b.size - a.size))
        .map(group => group.map(m => ({ ...m, screenIndex: counterIndex++ })))

    const flatList = groups.flat()

    const modalZoomRefMethods = useRef<{
        chamgeImageClass: () => void,
        fullScreenVideo: () => void,
        togleVideoControls: () => void
        playPauseVideo: () => void
        maxVolume: () => void,
        minVolume: () => void
    }>(null);

    const [open, setOpen] = useState(false);
    const [lastZoom, setLastZoom] = useState<Media>();
    const handleOpenPreview = (media: Media) => {
        setLastZoom(media)
        setOpen(true)
    };
    const handleClose = () => setOpen(false);

    const [lastClick, setLastClick] = useState<Media>()
    const lastClickedEvent = ($eventClick: Media) => { setLastClick($eventClick) }
    const shiftSelect = ($eventClick: Media) => { processSelection($eventClick, true) }
    const shiftControlSelect = ($eventClick: Media) => { processSelection($eventClick, false) }
    const processSelection = ($eventClick: Media, decision: boolean) => {
        const lastedId = lastClick?.screenIndex ?? -1
        const minor = Math.min(lastedId, $eventClick.screenIndex)
        const maxer = Math.max(lastedId, $eventClick.screenIndex)
        processChoice(
            flatList.filter(media => media.screenIndex >= minor && media.screenIndex <= maxer), decision
        )
        setLastClick($eventClick)
    }

    const processChoice = (mediasChoiced: Media[], decision: boolean) => {
        dispatch(updateManyArrayItem(
            mediasChoiced.map(photo => ({ ...photo, checked: decision }))
        ))
    }

    // Select-all skips imported fake items — they can never be moved, so a
    // check mark on them would only be noise. Unselect clears everything.
    const selectAll = () => processChoice(flatList.filter(m => !m.imported), true)
    const unselectAll = () => processChoice(flatList, false)

    // Within each group: checks every item for removal except one survivor,
    // chosen by type/audio priority — a video is always preferred over a gif
    // (and either over a plain image) regardless of file size, since a video
    // carries strictly more information. Within videos, one with sound beats
    // a muted one. The biggest item by size breaks ties within whichever
    // tier is non-empty.
    const selectDuplicatesToRemove = () => {
        const decided: Media[] = []
        for (const group of groups) {
            // Only actual-folder items get checked/spared: imported fake items
            // (database import) are other folders' files — not movable, and
            // they must not count as a group's surviving copy either.
            const own = group.filter(m => !m.imported)
            if (own.length === 0) continue
            const videos = own.filter(m => m.mime.includes('video'))
            const soundedVideos = videos.filter(m => m.hasAudio)
            const gifs = own.filter(m => m.mime.includes('gif'))
            const candidates = soundedVideos.length > 0 ? soundedVideos
                : videos.length > 0 ? videos
                : gifs.length > 0 ? gifs
                : own
            const spared = candidates.reduce((a, b) => b.size > a.size ? b : a)
            for (const media of own) {
                decided.push({ ...media, checked: media !== spared })
            }
        }
        dispatch(updateManyArrayItem(decided))
    }

    // Imported fake items (database import) stay out of scanning/indexing:
    // they live in other folders and must never enter this folder's index.
    const actualMedias = medias.filter(m => !m.imported)

    const scan = () => dispatch(FindDuplicates(actualMedias))
    const scanByHash = () => dispatch(FindIndexDuplicates())
    const openDiretory = () => dispatch(OpenDirectory())
    const openDiretoryRecursive = () => dispatch(OpenDirectoryRecursive())
    const rebuildIndex = () => {
        // Guards against the folder still being loaded (videos stream in one
        // at a time, so medias here can be empty or a small partial list —
        // rebuilding against it would silently "succeed" with nothing indexed).
        if (actualMedias.length === 0) {
            dispatch(indexRebuildFinished("No media loaded — open a folder first"))
            return
        }
        dispatch(RebuildIndex(actualMedias))
    }
    const exportDatabase = () => dispatch(ExportDatabase())
    const importDatabase = () => dispatch(ImportDatabase())

    const nextMedia = () => {
        if (!lastZoom) return;
        const idx = flatList.findIndex(m => m.id === lastZoom.id)
        if (idx === -1 || idx >= flatList.length - 1) return;
        setLastZoom(flatList[idx + 1])
    }
    const prevMedia = () => {
        if (!lastZoom) return;
        const idx = flatList.findIndex(m => m.id === lastZoom.id)
        if (idx <= 0) return;
        setLastZoom(flatList[idx - 1])
    }

    function pressedKeyUp(ev: KeyboardEvent<HTMLDivElement>): void {

        if (document.querySelector('[role="dialog"]')) return;
        if (!modalZoomRefMethods.current) return;


        if (ev.key === "s") {
            modalZoomRefMethods.current.playPauseVideo(); // Call the method in the child component
        }

        if (ev.key === "Escape") {
            setOpen(false); // Call the method in the child component
        }


        if (ev.key === "f") {
            modalZoomRefMethods.current.fullScreenVideo(); // Call the method in the child component
        }

        if (ev.key === "'") {
            modalZoomRefMethods.current.chamgeImageClass(); // Call the method in the child component
        }

        if (ev.key === "ArrowRight" && open) {
            nextMedia();
        }
        if (ev.key === "ArrowLeft" && open) {
            prevMedia();
        }
        if (ev.key === "1") {
            modalZoomRefMethods.current.togleVideoControls()
        }
        if (ev.key === "v") {
            modalZoomRefMethods.current.maxVolume()
        }
        if (ev.key === "b") {
            modalZoomRefMethods.current.minVolume()
        }

    }

    return (
        <div onKeyUp={(ev) => pressedKeyUp(ev)}>
            <DuplicatesResume>
                <IconButton onClick={scan} title="Scan loaded media for identical content (MD5)"><Refresh /></IconButton>
                <IconButton onClick={scanByHash} title="Scan indexed media for visual duplicates (perceptual hash)"><ImageSearch /></IconButton>
                <IconButton onClick={rebuildIndex} disabled={indexRebuilding || config.mediaLoading}
                    title={config.mediaLoading
                        ? "Still loading media from the folder — wait for it to finish before rebuilding"
                        : "Rebuild the compareImg vector index from the currently loaded media (use this if indexing errors show up in the console, e.g. a corrupted index)"}>
                    {indexRebuilding ? <CircularProgress size={20} /> : <RestartAlt />}
                </IconButton>
                <IconButton onClick={selectDuplicatesToRemove} disabled={groups.length === 0}
                    title="Check duplicates for removal in every group, keeping one survivor: a video is preferred over a gif or image (biggest with sound, else biggest muted), otherwise the biggest gif, otherwise the biggest item">
                    <VolumeOff />
                </IconButton>
                <IconButton onClick={exportDatabase} disabled={dbExporting}
                    title="Export the duplicate-detection database to a file, for importing and comparing against another library later">
                    {dbExporting ? <CircularProgress size={20} /> : <FileDownload />}
                </IconButton>
                <IconButton onClick={importDatabase} disabled={dbImporting || indexRebuilding}
                    title="Import another folder's exported database and find items duplicated across the two folders (requires this folder's index to exist)">
                    {dbImporting ? <CircularProgress size={20} /> : <FileUpload />}
                </IconButton>
                <IconButton onClick={selectAll} disabled={groups.length === 0} title="Select all items in the duplicate groups"><RadioButtonChecked /></IconButton>
                <IconButton onClick={unselectAll} disabled={groups.length === 0} title="Unselect all items in the duplicate groups"><RadioButtonUnchecked /></IconButton>
                <span>{groups.length} duplicate group{groups.length === 1 ? "" : "s"}</span>

                <div className="spacer" />

                <Folders screenMedias={flatList} />

                <IconButton onClick={openDiretory} title="Open folder to choose medias"><FolderOpen /></IconButton>
                <IconButton onClick={openDiretoryRecursive} title="Open folder recursively to choose medias"><FolderCopyTwoTone /></IconButton>
            </DuplicatesResume>
            <div>

                {config.mediaLoading && <span>Still loading media…</span>}
                {indexRebuildError && <CounterImgIndex>Index rebuild failed: {indexRebuildError}</CounterImgIndex>}
                {dbExportError && <CounterImgIndex>Database export failed: {dbExportError}</CounterImgIndex>}
                {dbImportError && <CounterImgIndex>Database import failed: {dbImportError}</CounterImgIndex>}
                {dbImportMatched === 0 && <CounterImgIndex>Import finished: no cross-folder duplicates found.</CounterImgIndex>}

            </div>

            {indexRebuilding &&
                <RebuildIndexInfo >
                    <CounterImgIndex>
                        Rebuilding index…{" "}
                        {indexRebuildProgress && indexRebuildProgress.total > 0
                            ? `${indexRebuildProgress.processed} / ${indexRebuildProgress.total}`
                            : "starting"}
                    </CounterImgIndex>
                    <LinearProgress
                        variant={indexRebuildProgress && indexRebuildProgress.total > 0 ? "determinate" : "indeterminate"}
                        value={indexRebuildProgress && indexRebuildProgress.total > 0
                            ? (indexRebuildProgress.processed / indexRebuildProgress.total) * 100
                            : 0}
                    />
                </RebuildIndexInfo>
            }

            {groups.length > 0
                ? <DuplicatesList>
                    {groups.map((group, idx) => (
                        <DuplicateGroupCard key={group[0].id}>
                            <GroupLabel>Group {idx + 1} — {group.length} identical files{group.some(m => m.imported) ? ` (${group.filter(m => m.imported).length} from other folder)` : ""}</GroupLabel>
                            <DuplicateGroupRow>
                                {group.map(media => {
                                    const tile = <MediaIMG key={media.id} media={media}
                                        lastClickedEvent={lastClickedEvent}
                                        shiftSelect={shiftSelect}
                                        shiftControlSelect={shiftControlSelect}
                                        handleOpenPreview={handleOpenPreview}
                                        isLastSeen={lastZoom?.id === media.id}
                                    />
                                    return media.imported
                                        ? <ImportedMediaWrap key={media.id}>{tile}</ImportedMediaWrap>
                                        : tile
                                })}
                            </DuplicateGroupRow>
                        </DuplicateGroupCard>
                    ))}
                </DuplicatesList>
                : <EmptyState>No duplicates found yet. Click the scan button to compare the loaded media by content.</EmptyState>
            }

            <MediaTypeFilter />

            {lastZoom &&
                <ModalZoom mediaWithPreview={lastZoom} handleExternalClose={handleClose} openModal={open} ref={modalZoomRefMethods}
                    onPrev={prevMedia}
                    onNext={nextMedia}
                ></ModalZoom>
            }
        </div>
    )
})
