import styled from "@emotion/styled";
import { Add } from "@mui/icons-material";
import { Button, IconButton } from "@mui/material";




export const FolderGrid = styled.div`
        background: antiquewhite;
        height: 40px;
        place-content: center flex-start;
        padding: 0px;
        margin: 0px;
        width: 100%;
        display: inline-flex;
        flex-wrap: nowrap;
        -webkit-box-pack: start;
        -webkit-box-align: center;
        align-items: center;
        position: absolute;
        top: 2px;
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