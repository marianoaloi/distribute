import styled from "@emotion/styled";
import { Typography } from "@mui/material";



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




