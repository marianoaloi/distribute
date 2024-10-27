import { Add, Delete } from "@mui/icons-material"
import { selectMedias, SendSelectedFiles, updateArrayItem, updateManyArrayItem, useDispatch, useSelector } from "../lib/redux"
import { addFolder, removeFolder, workFolder } from "../lib/redux/slices/folders"
import { AddFolder, ButtonDelete, ButtonFolder, FolderGrid } from "./folder.styled"
import React from "react"
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, TextField } from "@mui/material"
import { Media } from "../entity/Media"




export const Folders: React.FC<{ mediaOnlyCopy?: Media, handleExternalClose?: any }> = ({ mediaOnlyCopy, handleExternalClose }) => {

    const folders = useSelector(workFolder)
    const [open, setOpen] = React.useState(false);
    const [onlyCopy, setOnlyCopy] = React.useState((mediaOnlyCopy === undefined))

    const dispatch = useDispatch();

    const handleClickOpen = () => {
        setOpen(true);
    };

    const handleClose = () => {
        setOpen(false);
    };

    const ButtonProcess: React.FC<{ fol: string }> = ({ fol }) => {
        const medias = useSelector(selectMedias)

        const dispatch = useDispatch();
        function sendSelected(folder: string): void {
            if (!mediaOnlyCopy) {

                const mediasFilter = medias.filter(m => m.checked).map(m => {
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
        function deleteFolder(fol: string): void {
            dispatch(removeFolder(fol))
        }

        return <>
            <ButtonFolder variant="contained" onClick={() => sendSelected(fol)} >{fol} </ButtonFolder>
            <ButtonDelete title={`delete ${fol}`} onClick={() => deleteFolder(fol)}><Delete fontSize="small" /></ButtonDelete>
        </>
    }

    return <FolderGrid>
        <AddFolder onClick={handleClickOpen}  >
            <Add titleAccess="Add folder" />
        </AddFolder>
        {mediaOnlyCopy ?
            <input type="checkbox" readOnly onClick={(ev) => setOnlyCopy(ev.currentTarget.checked)} checked={onlyCopy} aria-label="Only Copy" title="Only copy" />
            : ""}
        {folders.map(fol => <ButtonProcess key={fol} fol={fol} />)}
        <React.Fragment>


            <Dialog
                open={open}
                onClose={handleClose}
                PaperProps={{
                    component: 'form',
                    onSubmit: (event: React.FormEvent<HTMLFormElement>) => {
                        event.preventDefault();
                        const formData = new FormData(event.currentTarget);
                        const formJson = Object.fromEntries((formData as any).entries());
                        const folder = formJson.folder;
                        console.log(folder);
                        dispatch(addFolder(folder))
                        handleClose();
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
                    <Button onClick={handleClose}>Cancel</Button>
                    <Button type="submit">Add</Button>
                </DialogActions>
            </Dialog>
        </React.Fragment>
    </FolderGrid>
}