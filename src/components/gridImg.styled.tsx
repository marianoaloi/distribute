import styled from "@emotion/styled";
import { Typography } from "@mui/material";



export const ImgGrid = styled.div`
    display: flex;
    flex-flow: wrap;
    -webkit-box-align: center;
    align-items: flex-start;
    place-content: flex-start space-around;
    margin: 12px 0px;
    justify-content: space-around;
    align-content: flex-start;
    flex-wrap: wrap;
    flex-direction: row;
`

export const Resume = styled.div`
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
    justify-content: space-around;
    padding: 8px 16px;
    gap: 12px;
    z-index: 4;

    /* Style the embedded Typography count elements */
    color: #e0e0e0;

    /* Style select and text input elements */
    select, input[type='text'] {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: #fff;
        border-radius: 4px;
        padding: 4px 8px;
        outline: none;
        font-family: inherit;
        font-size: 14px;
        transition: border-color 0.2s, background-color 0.2s;

        &:hover {
            background: rgba(255, 255, 255, 0.12);
            border-color: rgba(255, 255, 255, 0.3);
        }

        &:focus {
            border-color: #1976d2;
            background: rgba(255, 255, 255, 0.15);
        }
    }

    select {
        option {
            background-color: #282c34;
            color: #fff;
        }
    }

    /* Style Material UI IconButtons to be white/light grey by default */
    .MuiIconButton-root {
        color: rgba(255, 255, 255, 0.7);
        transition: color 0.2s, background-color 0.2s;
        
        &:hover {
            color: #fff;
            background-color: rgba(255, 255, 255, 0.08);
        }
        
        &.Mui-disabled {
            color: rgba(255, 255, 255, 0.3);
        }
    }

    /* Keep inputs inside flex layouts neat */
    .buttons {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .spacer {
        flex-grow: 1;
    }
`

export const Qtd = styled(Typography)`
            margin: 0px 12px;
`

export const FilterBar = styled.div`
    position: fixed;
    bottom: 16px;
    right: 16px;
    background: rgba(30, 34, 43, 0.95);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 50%;
    z-index: 2;
    display: flex;
    width: 48px;
    height: 48px;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    transition: transform 0.2s, background-color 0.2s;

    &:hover {
        background: rgba(40, 45, 55, 0.98);
        transform: translateY(-2px);
    }

    .MuiIconButton-root {
        color: rgba(255, 255, 255, 0.8);
        transition: color 0.2s, background-color 0.2s;
        
        &:hover {
            color: #fff;
            background-color: transparent;
        }
    }
`



