import styled from "@emotion/styled";
import { Button, IconButton } from "@mui/material";




export const FolderGrid = styled.div`
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 4px;
        padding: 4px 8px;
        margin: 0px;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        min-height: 32px;
        height: auto;

        .onlyCopyLabel {
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 13px;
            user-select: none;
            cursor: pointer;
            color: #ccc;
            white-space: nowrap;
        }
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