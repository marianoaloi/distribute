import styled from "@emotion/styled";
import { Box, Typography } from "@mui/material";



export const ImgGrid = styled.div`
    display: flex;
    flex-flow: wrap;
    -webkit-box-align: center;
    align-items: flex-start;
    place-content: flex-start space-around;
    margin: 50px 0px;
    justify-content: space-around;
    align-content: flex-start;
    flex-wrap: wrap;
    flex-direction: row;
`

export const Resume = styled.div`
    float: left;
    position: fixed;
    left: 0px;
    background: red;
    top: 0px;
    display: inline-flex;
    height: 40px;
    align-items: center;
    flex-wrap: nowrap;
    justify-content: space-around;
    z-index: 4;
`

export const Qtd = styled(Typography)`
            margin: 0px 12px;
`

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
    max-width: 100%;
    max-height: 100%;
    overflow: scroll;

`