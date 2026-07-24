import { useRef, useState } from "react"
import { useDispatch } from "react-redux"
import { IconButton, CircularProgress, LinearProgress } from "@mui/material"
import { Refresh, ImageSearch, RestartAlt } from "@mui/icons-material"
import { Media } from "../entity/Media"
import { FindDuplicates, FindIndexDuplicates, RebuildIndex, selectDuplicateGroups, selectIndexRebuildError, selectIndexRebuilding, selectIndexRebuildProgress, selectMedias, updateManyArrayItem, useSelector } from "../lib/redux"
import { MediaIMG } from "./media"
import ModalZoom from "./modalZoom"
import { DuplicateGroupCard, DuplicateGroupRow, DuplicatesList, DuplicatesResume, EmptyState, GroupLabel } from "./duplicatesGrid.styled"

export const GridDuplicates = (() => {

    const dispatch = useDispatch<any>();

    const medias = useSelector(selectMedias).filter(m => !m.deleted)
    const groupIds = useSelector(selectDuplicateGroups)
    const indexRebuilding = useSelector(selectIndexRebuilding)
    const indexRebuildError = useSelector(selectIndexRebuildError)
    const indexRebuildProgress = useSelector(selectIndexRebuildProgress)

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

    const scan = () => dispatch(FindDuplicates(medias))
    const scanByHash = () => dispatch(FindIndexDuplicates())
    const rebuildIndex = () => dispatch(RebuildIndex(medias))

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

    return (
        <div>
            <DuplicatesResume>
                <IconButton onClick={scan} title="Scan loaded media for identical content (MD5)"><Refresh /></IconButton>
                <IconButton onClick={scanByHash} title="Scan indexed media for visual duplicates (perceptual hash)"><ImageSearch /></IconButton>
                <IconButton onClick={rebuildIndex} disabled={indexRebuilding}
                    title="Rebuild the compareImg vector index from the currently loaded media (use this if indexing errors show up in the console, e.g. a corrupted index)">
                    {indexRebuilding ? <CircularProgress size={20} /> : <RestartAlt />}
                </IconButton>
                <span>{groups.length} duplicate group{groups.length === 1 ? "" : "s"}</span>
                {indexRebuildError && <span>Index rebuild failed: {indexRebuildError}</span>}
            </DuplicatesResume>

            {indexRebuilding &&
                <div style={{ padding: "4px 8px" }}>
                    <span>
                        Rebuilding index…{" "}
                        {indexRebuildProgress && indexRebuildProgress.total > 0
                            ? `${indexRebuildProgress.processed} / ${indexRebuildProgress.total}`
                            : "starting"}
                    </span>
                    <LinearProgress
                        variant={indexRebuildProgress && indexRebuildProgress.total > 0 ? "determinate" : "indeterminate"}
                        value={indexRebuildProgress && indexRebuildProgress.total > 0
                            ? (indexRebuildProgress.processed / indexRebuildProgress.total) * 100
                            : 0}
                    />
                </div>
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

            {lastZoom &&
                <ModalZoom mediaWithPreview={lastZoom} handleExternalClose={handleClose} openModal={open} ref={modalZoomRefMethods}
                    onPrev={prevMedia}
                    onNext={nextMedia}
                ></ModalZoom>
            }
        </div>
    )
})
