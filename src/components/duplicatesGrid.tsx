import { KeyboardEvent, useRef, useState } from "react"
import { useDispatch } from "react-redux"
import { IconButton, CircularProgress, LinearProgress } from "@mui/material"
import { Refresh, ImageSearch, RestartAlt, FolderOpen, FolderCopyTwoTone, VolumeOff, FileDownload } from "@mui/icons-material"
import { Media } from "../entity/Media"
import { ExportDatabase, FindDuplicates, FindIndexDuplicates, OpenDirectory, OpenDirectoryRecursive, RebuildIndex, indexRebuildFinished, selectDbExportError, selectDbExporting, selectDuplicateGroups, selectIndexRebuildError, selectIndexRebuilding, selectIndexRebuildProgress, selectMedias, updateManyArrayItem, useSelector } from "../lib/redux"
import { configurationsSelector } from "../lib/redux/slices/configurations"
import { MediaIMG } from "./media"
import ModalZoom from "./modalZoom"
import { CounterImgIndex, DuplicateGroupCard, DuplicateGroupRow, DuplicatesList, DuplicatesResume, EmptyState, GroupLabel, RebuildIndexInfo } from "./duplicatesGrid.styled"
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

    const mediaById = new Map(medias.map(m => [m.id, m]))

    let counterIndex = 0
    const groups: Media[][] = groupIds
        .map(ids => ids.map(id => mediaById.get(id)).filter((m): m is Media => !!m))
        .filter(group => group.length > 1)
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

    // Within each group: checks the muted (no-audio) video copies for removal,
    // keeping a sounded copy unchecked as the survivor. If every video in a
    // group is muted (no sounded copy to keep instead), one muted copy is
    // spared - checking all of them would leave nothing to keep. Images follow
    // a separate rule: check every image in the group for removal except the
    // largest (by file size), which is kept as the survivor.
    const selectDuplicatesToRemove = () => {
        const decided: Media[] = []
        for (const group of groups) {
            const videos = group.filter(m => m.mime && m.mime.includes('video'))
            const muted = videos.filter(m => !m.hasAudio)
            const sounded = videos.filter(m => m.hasAudio)
            if (muted.length > 0) {
                const spared = sounded.length > 0 ? null : muted[0]
                for (const video of videos) {
                    decided.push({ ...video, checked: video !== spared && !video.hasAudio })
                }
            }

            const images = group.filter(m => m.mime && m.mime.includes('image'))
            if (images.length > 0) {
                const biggest = images.reduce((a, b) => b.size > a.size ? b : a)
                for (const image of images) {
                    decided.push({ ...image, checked: image !== biggest })
                }
            }
        }
        dispatch(updateManyArrayItem(decided))
    }

    const scan = () => dispatch(FindDuplicates(medias))
    const scanByHash = () => dispatch(FindIndexDuplicates())
    const openDiretory = () => dispatch(OpenDirectory())
    const openDiretoryRecursive = () => dispatch(OpenDirectoryRecursive())
    const rebuildIndex = () => {
        // Guards against the folder still being loaded (videos stream in one
        // at a time, so medias here can be empty or a small partial list —
        // rebuilding against it would silently "succeed" with nothing indexed).
        if (medias.length === 0) {
            dispatch(indexRebuildFinished("No media loaded — open a folder first"))
            return
        }
        dispatch(RebuildIndex(medias))
    }
    const exportDatabase = () => dispatch(ExportDatabase())

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
                    title="Check duplicates for removal in every group: muted video copies (keeping one sounded, or one muted if none are sounded) and images (keeping the largest)">
                    <VolumeOff />
                </IconButton>
                <IconButton onClick={exportDatabase} disabled={dbExporting}
                    title="Export the duplicate-detection database to a file, for importing and comparing against another library later">
                    {dbExporting ? <CircularProgress size={20} /> : <FileDownload />}
                </IconButton>
                <span>{groups.length} duplicate group{groups.length === 1 ? "" : "s"}</span>

                <div className="spacer" />

                <Folders />

                <IconButton onClick={openDiretory} title="Open folder to choose medias"><FolderOpen /></IconButton>
                <IconButton onClick={openDiretoryRecursive} title="Open folder recursively to choose medias"><FolderCopyTwoTone /></IconButton>
            </DuplicatesResume>
            <div>

                {config.mediaLoading && <span>Still loading media…</span>}
                {indexRebuildError && <CounterImgIndex>Index rebuild failed: {indexRebuildError}</CounterImgIndex>}
                {dbExportError && <CounterImgIndex>Database export failed: {dbExportError}</CounterImgIndex>}

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
                            <GroupLabel>Group {idx + 1} — {group.length} identical files</GroupLabel>
                            <DuplicateGroupRow>
                                {group.map(media => (
                                    <MediaIMG key={media.id} media={media}
                                        lastClickedEvent={lastClickedEvent}
                                        shiftSelect={shiftSelect}
                                        shiftControlSelect={shiftControlSelect}
                                        handleOpenPreview={handleOpenPreview}
                                    />
                                ))}
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
