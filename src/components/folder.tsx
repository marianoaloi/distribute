import { Add, Delete } from "@mui/icons-material"
import { selectMedias, SendSelectedFiles, updateArrayItem, updateManyArrayItem, useDispatch, useSelector } from "../lib/redux"
import { addFolder, removeFolder, workFolder } from "../lib/redux/slices/folders"
import { AddFolder, ButtonDelete, ButtonFolder, FolderGrid } from "./folder.styled"
import React from "react"
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, TextField } from "@mui/material"
import { Media } from "../entity/Media"




export const Folders: React.FC<{ mediaOnlyCopy?: Media, handleExternalClose?: any }> = ({ mediaOnlyCopy, handleExternalClose }) => {

    const folders = useSelector(workFolder)
    const [openNewFolder, setOpenNewFolder] = React.useState(false);
    const [openDelete, setOpenDelete] = React.useState(false);
    const [folderDelete, setFolderDelete] = React.useState("");
    const [onlyCopy, setOnlyCopy] = React.useState((mediaOnlyCopy === undefined))

    const dispatch = useDispatch();

    const handleClickOpenNewFolder = () => {
        setOpenNewFolder(true);
    };

    const handleCloseNewFolder = () => {
        setOpenNewFolder(false);
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

                const mediasFilter = medias.filter(m => m.checked && !m.deleted).map(m => {
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

    return <FolderGrid>
        <AddFolder onClick={handleClickOpenNewFolder}  >
            <Add titleAccess="Add folder" />
        </AddFolder>
        {mediaOnlyCopy ?
            <input type="checkbox" readOnly onClick={(ev) => setOnlyCopy(ev.currentTarget.checked)} checked={onlyCopy} aria-label="Only Copy" title="Only copy" />
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
        </React.Fragment>
    </FolderGrid>
}