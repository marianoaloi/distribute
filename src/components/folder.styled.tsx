import styled from "@emotion/styled";
import { Add } from "@mui/icons-material";
import { Button, IconButton } from "@mui/material";




export const FolderGrid = styled.div`
    background: antiquewhite;
    height: 34px;
    align-content: center;
    padding: 3px;

    position: fixed;
    bottom: 0px;
    width: 100%;

    display: inline-flex;
    flex-wrap: nowrap;
    justify-content: flex-start;
    align-items: center;
`

export const AddFolder = styled(IconButton)`


`

export const ButtonFolder = styled(Button)`
    margin: 0px 3px;
`

export const ButtonDelete = styled(IconButton)`
    // background: #1976d2
        margin-left: -17px;
`