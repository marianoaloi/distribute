import { Add, CallSplit, Delete } from "@mui/icons-material"
import { selectMedias, SendSelectedFiles, updateArrayItem, updateManyArrayItem, useDispatch, useSelector } from "../lib/redux"
import { addFolder, removeFolder, setSplitMoveCheckedFolder, setSplitMoveUncheckedFolder, splitMoveCheckedFolder, splitMoveUncheckedFolder, workFolder } from "../lib/redux/slices/folders"
import { AddFolder, ButtonDelete, ButtonFolder, FolderGrid } from "./folder.styled"
import React from "react"
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, FormControl, InputLabel, MenuItem, Select, TextField } from "@mui/material"
import { Media } from "../entity/Media"




export const Folders: React.FC<{ mediaOnlyCopy?: Media, handleExternalClose?: any, className?: string, screenMedias?: Media[] }> = ({ mediaOnlyCopy, handleExternalClose, className, screenMedias }) => {

    const folders = useSelector(workFolder)
    const [openNewFolder, setOpenNewFolder] = React.useState(false);
    const [openDelete, setOpenDelete] = React.useState(false);
    const [folderDelete, setFolderDelete] = React.useState("");
    const [onlyCopy, setOnlyCopy] = React.useState((mediaOnlyCopy === undefined))
    const [openSplitMove, setOpenSplitMove] = React.useState(false);

    const [ctrlPressed, setCtrlPressed] = React.useState(false);

    React.useEffect(() => {
        const onKeyDown = (ev: KeyboardEvent) => { if (ev.key === "Control") setCtrlPressed(true) }
        const onKeyUp = (ev: KeyboardEvent) => { if (ev.key === "Control") setCtrlPressed(false) }
        // Alt-tab/Ctrl-tab steals focus before keyup lands, which would leave
        // the icon stuck gold long after Ctrl was released.
        const onBlur = () => setCtrlPressed(false)
        window.addEventListener("keydown", onKeyDown)
        window.addEventListener("keyup", onKeyUp)
        window.addEventListener("blur", onBlur)
        return () => {
            window.removeEventListener("keydown", onKeyDown)
            window.removeEventListener("keyup", onKeyUp)
            window.removeEventListener("blur", onBlur)
        }
    }, [])

    // Remembered in redux (not local state) so the same checked/unchecked
    // destinations carry over the next time this dialog is opened - the
    // whole point being to repeat the same split-move strategy without
    // re-picking folders every time. Falls back to "" if the remembered
    // folder was since removed from the folders list.
    const savedUncheckedDestFolder = useSelector(splitMoveUncheckedFolder)
    const savedCheckedDestFolder = useSelector(splitMoveCheckedFolder)
    const uncheckedDestFolder = folders.includes(savedUncheckedDestFolder) ? savedUncheckedDestFolder : ""
    const checkedDestFolder = folders.includes(savedCheckedDestFolder) ? savedCheckedDestFolder : ""

    const dispatch = useDispatch();

    const handleClickOpenNewFolder = () => {
        setOpenNewFolder(true);
    };

    const handleCloseNewFolder = () => {
        setOpenNewFolder(false);
    };

    // Scoped to exactly what the caller has on screen (e.g. gridImg's
    // current page, or duplicatesGrid's flat list) - NOT the whole redux
    // store. "Unchecked" is the default state, so acting on the global store
    // would sweep in every other page/screen's untouched media too.
    const splitScreenMedias = screenMedias ?? []
    const uncheckedCount = splitScreenMedias.filter(m => !m.checked && !m.deleted && !m.imported).length
    const checkedCount = splitScreenMedias.filter(m => m.checked && !m.deleted && !m.imported).length

    const handleClickOpenSplitMove = (ev: React.MouseEvent) => {
        if (ev.ctrlKey && uncheckedDestFolder && checkedDestFolder) {
            handleSplitMove();
            return;
        }
        setOpenSplitMove(true);
    };

    const handleCloseSplitMove = () => {
        setOpenSplitMove(false);
    };

    // Moves the unchecked media to one folder and the checked media to
    // another in a single action, so both halves of a duplicates pass can be
    // filed away without the unchecked side (which never gets a "process"
    // button of its own) being left behind.
    const handleSplitMove = () => {
        // moveFile (app.js) only acts on items whose payload `checked` is
        // true, so the unchecked group is sent with checked forced true -
        // same trick the single-media onlyCopy-false path below already
        // uses - then restored to its real value for the redux update
        // (harmless either way since `deleted: true` hides it regardless).
        const uncheckedWire = splitScreenMedias
            .filter(m => !m.checked && !m.deleted && !m.imported)
            .map(m => ({ ...m, checked: true }))
        if (uncheckedWire.length > 0) {
            SendSelectedFiles(uncheckedDestFolder, false, uncheckedWire)
            dispatch(updateManyArrayItem(uncheckedWire.map(m => ({ ...m, checked: false, deleted: true }))))
        }

        const checkedMedias = splitScreenMedias
            .filter(m => m.checked && !m.deleted && !m.imported)
            .map(m => ({ ...m, deleted: true }))
        if (checkedMedias.length > 0) {
            SendSelectedFiles(checkedDestFolder, false, checkedMedias)
            dispatch(updateManyArrayItem(checkedMedias))
        }

        handleCloseSplitMove();
    };


    const handleClickOpenDelete = (fol: string) => {
        setFolderDelete(fol)
        setOpenDelete(true);
    };

    const handleCloseDelete = () => {
        setOpenDelete(false);
    };

    const ButtonProcess: React.FC<{ fol: string }> = ({ fol }) => {
        const medias = useSelector(selectMedias)

        const dispatch = useDispatch();
        function sendSelected(folder: string): void {
            if (!mediaOnlyCopy) {

                // Imported fake items represent files in OTHER folders — even
                // when checked they must never be moved (app.js re-filters too).
                const mediasFilter = medias.filter(m => m.checked && !m.deleted && !m.imported).map(m => {
                    const aux = { ...m }
                    aux.deleted = true
                    return aux
                })
                SendSelectedFiles(folder, false, mediasFilter)

                dispatch(updateManyArrayItem(mediasFilter))

            } else {

                const aux = { ...mediaOnlyCopy }
                aux.checked = true
                if (onlyCopy) {
                    SendSelectedFiles(folder, true, [aux])
                } else {
                    SendSelectedFiles(folder, false, [aux])

                    aux.deleted = true
                    aux.checked = mediaOnlyCopy.checked
                    dispatch(updateArrayItem(aux))
                }
                handleExternalClose();
            }
        }

        return <>
            <ButtonFolder variant="contained" onClick={() => sendSelected(fol)} >{fol} </ButtonFolder>
            <ButtonDelete title={`delete ${fol}`} onClick={() => handleClickOpenDelete(fol)}><Delete fontSize="small" /></ButtonDelete>
        </>
    }



    function deleteFolder(): void {

        dispatch(removeFolder(folderDelete))
        handleCloseDelete()

    }

    return <FolderGrid className={className}>
        <AddFolder onClick={handleClickOpenNewFolder}  >
            <Add titleAccess="Add folder" />
        </AddFolder>
        {!mediaOnlyCopy && screenMedias &&
            <AddFolder onClick={handleClickOpenSplitMove} title="Move checked and unchecked media to two different folders in one action">
                <CallSplit titleAccess="Move checked/unchecked to different folders" sx={ctrlPressed ? { color: "gold" } : undefined} />
            </AddFolder>
        }
        {mediaOnlyCopy ?
            <label className="onlyCopyLabel">
                <input type="checkbox" readOnly onClick={(ev) => setOnlyCopy(ev.currentTarget.checked)} checked={onlyCopy} aria-label="Only Copy" title="Only copy" />
                Only Copy
            </label>
            : ""}
        {folders.map(fol => <ButtonProcess key={fol} fol={fol} />)}
        <React.Fragment>


            <Dialog
                open={openNewFolder}
                onClose={handleCloseNewFolder}
                PaperProps={{
                    component: 'form',
                    onSubmit: (event: React.FormEvent<HTMLFormElement>) => {
                        event.preventDefault();
                        const formData = new FormData(event.currentTarget);
                        const formJson = Object.fromEntries((formData as any).entries());
                        const folder = formJson.folder;
                        console.log(folder);
                        dispatch(addFolder(folder))
                        handleCloseNewFolder();
                    },
                }}
            >
                <DialogTitle>Subscribe</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        Add a new folder to organize your Medias
                    </DialogContentText>
                    <TextField
                        autoFocus
                        required
                        margin="dense"
                        id="folder"
                        name="folder"
                        label="Folder Name"
                        type="folder"
                        fullWidth
                        variant="standard"
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseNewFolder}>Cancel</Button>
                    <Button type="submit">Add</Button>
                </DialogActions>
            </Dialog>

            <Dialog
                open={openDelete}
                onClose={handleCloseDelete}
                aria-labelledby="alert-dialog-title"
                aria-describedby="alert-dialog-description"
            >
                <DialogTitle id="alert-dialog-title">
                    {`Do you want delete the folder ${folderDelete} ?`}
                </DialogTitle>
                <DialogContent>
                    <DialogContentText id="alert-dialog-description">
                        You will delete the {folderDelete} from the application.
                        But the app not delete phisicaly the folder, only in app.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseDelete}>Disagree</Button>
                    <Button onClick={deleteFolder} autoFocus>
                        Agree
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog
                open={openSplitMove}
                onClose={handleCloseSplitMove}
            >
                <DialogTitle>Move checked and unchecked media</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        Moves the unchecked media to one folder and the checked media to another, in a single action.
                    </DialogContentText>
                    <FormControl fullWidth margin="dense" sx={{ mt: 2 }}>
                        <InputLabel id="split-move-unchecked-label">{`Destination for UNCHECKED (${uncheckedCount})`}</InputLabel>
                        <Select
                            labelId="split-move-unchecked-label"
                            label={`Destination for UNCHECKED (${uncheckedCount})`}
                            fullWidth
                            displayEmpty
                            value={uncheckedDestFolder}
                            onChange={(ev) => dispatch(setSplitMoveUncheckedFolder(ev.target.value))}
                        >
                            <MenuItem value="" disabled>Choose a folder</MenuItem>
                            {folders.map(fol => <MenuItem key={fol} value={fol}>{fol}</MenuItem>)}
                        </Select>
                    </FormControl>
                    <FormControl fullWidth margin="dense" sx={{ mt: 2 }}>
                        <InputLabel id="split-move-checked-label">{`Destination for CHECKED (${checkedCount})`}</InputLabel>
                        <Select
                            labelId="split-move-checked-label"
                            label={`Destination for CHECKED (${checkedCount})`}
                            fullWidth
                            displayEmpty
                            value={checkedDestFolder}
                            onChange={(ev) => dispatch(setSplitMoveCheckedFolder(ev.target.value))}
                        >
                            <MenuItem value="" disabled>Choose a folder</MenuItem>
                            {folders.map(fol => <MenuItem key={fol} value={fol}>{fol}</MenuItem>)}
                        </Select>
                    </FormControl>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseSplitMove}>Cancel</Button>
                    <Button onClick={handleSplitMove} disabled={!uncheckedDestFolder || !checkedDestFolder}>
                        Move
                    </Button>
                </DialogActions>
            </Dialog>
        </React.Fragment>
    </FolderGrid>
}