import styled from "@emotion/styled";
import { Box, Slider } from "@mui/material";
import { Folders } from "./folder";


export const ModalBox = styled(Box)`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
//   width: 60em;
  background: white;
  border: 2px solid #000;
  box-shadow: 10px 10px 5px 0px rgb(135 127 127);
  padding: 4px;
    max-width: 90%;
    max-height: 90%;
    overflow: scroll;

`

export const MediaPresentation = styled.div`

`

export const VideoPresentation = styled.video`
`

export const ImgPresentation = styled.img`
`

export const ControlSlider = styled(Slider)`

max-width: 30%;

`

export const FoldersZoom = styled(Folders)`
        position: sticky;
    top: 0px;
    z-index: 2;
`

export const MediaControllersCSS = styled.div`
        display: flex;
    flex-direction: row;
    align-content: flex-start;
    flex-wrap: nowrap;
    justify-content: flex-start;
    align-items: center;
    position: sticky;
    z-index: 2;
    bottom: 0px;
    background: antiquewhite;
    width: 100%;
    padding-top: 20px;
`