import styled from "@emotion/styled";
import { Box, Slider } from "@mui/material";
import { Folders } from "./folder";
import { VolumeMuteRounded } from "@mui/icons-material";


export const ModalBox = styled(Box)`
    //   width: 60em;
    background: white;
    border: 2px solid #000;
    box-shadow: 10px 10px 5px 0px rgb(135 127 127);
    height: 90%;
    left: 50%;
    overflow: unset;
    padding: 4px;
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 90%;
    margin: 0px;
    padding: 0px;

`

export const MediaPresentation = styled.div`
    width: 100%;
    height: calc(100% - 100px);
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    overflow: auto;

`

export const VideoPresentation = styled.video`
      position: absolute;
    //   top: 50%;
    //   left: 50%;
    //   transform: translate(-50%, -50%);
    text-align: center;
      overflow: auto;
      max-height: 100%;
      width: 100%;
`

export const ImgPresentation = styled.img`
      position: absolute;
      overflow: auto;
`

export const ControlSlider = styled(Slider)`

max-width: 30%;

`

export const ZoomHeader = styled.div`
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 4px 12px;
    background: #f5f5f5;
    border-bottom: 1px solid #e0e0e0;
    height: 40px;
    box-sizing: border-box;
`

export const FoldersZoom = styled(Folders)`
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    overflow-x: auto;
    background: transparent;
    border: none;
    padding: 0px;
    margin: 0px;
    gap: 4px;
    min-height: unset;
    height: 32px;
    flex: 1;

    /* Hide scrollbar for a clean look but allow scrolling if there are many folders */
    &::-webkit-scrollbar {
        display: none;
    }
    -ms-overflow-style: none;  /* IE and Edge */
    scrollbar-width: none;  /* Firefox */

    /* Style buttons inside FoldersZoom to be compact and fit in the header/footer */
    .MuiButton-root {
        height: 26px;
        padding: 2px 8px;
        font-size: 11px;
        text-transform: none;
        min-width: unset;
        white-space: nowrap;
        background-color: #1976d2;
        color: white;
        
        &:hover {
            background-color: #115293;
        }
    }

    /* Style IconButtons (delete/add) inside FoldersZoom to be compact */
    .MuiIconButton-root {
        padding: 2px;
        height: 26px;
        width: 26px;
        color: #555;
        
        svg {
            font-size: 16px;
        }
    }

    /* Spacing between folder button and delete button */
    .MuiButton-root + .MuiIconButton-root {
        margin-left: -10px;
    }

    /* Style the Only Copy checkbox label for the zoom view */
    .onlyCopyLabel {
        color: #333;
        font-weight: 500;
        margin-right: 8px;
    }
`
export const InfoBox = styled.div`
    position: fixed;
    top: 10px;
    right: 10px;
    z-index: 3;
`
export const MuteIcon = styled(VolumeMuteRounded)`
    color: red;
    height: 100px;
    width: 100px;

`

export const MediaControllersCSS = styled.div`
    align-content: flex-end;
    align-items: center;
    background: antiquewhite;
    bottom: 0px;
    display: flex;
    flex-direction: row;
    flex-wrap: nowrap;
    height: 35px;
    justify-content: flex-end;
    padding-top: 20px;
    position: absolute;
    width: 100%;
    z-index: 2;
`