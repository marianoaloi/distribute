import styled from "@emotion/styled";
import { Box, Slider } from "@mui/material";
import { Folders } from "./folder";


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
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      overflow: auto;
      max-height: 100%;
      width: 100%;
`

export const ImgPresentation = styled.img`
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      overflow: auto;
      max-height: 100%;
      max-width: 100%;
`

export const ControlSlider = styled(Slider)`

max-width: 30%;

`

export const FoldersZoom = styled(Folders)`
    position: sticky;
    height: 35px;
    top: 0px;
    z-index: 2;
`

export const MediaControllersCSS = styled.div`
    align-content: flex-start;
    align-items: center;
    background: antiquewhite;
    bottom: 0px;
    display: flex;
    flex-direction: row;
    flex-wrap: nowrap;
    height: 35px;
    justify-content: flex-start;
    padding-top: 20px;
    position: absolute;
    width: 100%;
    z-index: 2;
`