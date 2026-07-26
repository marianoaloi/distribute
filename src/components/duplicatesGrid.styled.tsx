import styled from "@emotion/styled";
import { Typography } from "@mui/material";

export const DuplicatesResume = styled.div`
    position: sticky;
    top: 0px;
    left: 0px;
    right: 0px;
    width: 100%;
    box-sizing: border-box;
    background: rgba(30, 34, 43, 0.95);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    display: flex;
    min-height: 48px;
    height: auto;
    align-items: center;
    flex-wrap: wrap;
    justify-content: flex-start;
    padding: 8px 16px;
    gap: 12px;
    z-index: 4;
    color: #e0e0e0;

    .MuiIconButton-root {
        color: rgba(255, 255, 255, 0.7);
        transition: color 0.2s, background-color 0.2s;

        &:hover {
            color: #fff;
            background-color: rgba(255, 255, 255, 0.08);
        }
    }

    
    .spacer {
        flex-grow: 1;
    }
`

export const DuplicatesList = styled.div`
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin: 16px;
`

export const DuplicateGroupCard = styled.div`
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.03);
`

export const DuplicateGroupRow = styled.div`
    display: flex;
    flex-flow: wrap;
    align-items: flex-start;
    gap: 8px;
`

export const GroupLabel = styled(Typography)`
    color: rgba(255, 255, 255, 0.6);
    font-size: 13px;
`

export const EmptyState = styled.div`
    margin: 32px;
    color: rgba(255, 255, 255, 0.6);
`


export const CounterImgIndex = styled.span`
    color: rgba(255, 255, 255, 0.6);
    font-size: 13px;
    background: white;
    margin: 15px 0px;
    padding: 15px 10px;
`