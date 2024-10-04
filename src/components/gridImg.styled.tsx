import styled from "@emotion/styled";
import { Typography } from "@mui/material";



export const ImgGrid = styled.div`
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-around;
    align-content: flex-start;

    margin-top: 50px;
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
`

export const Qtd = styled(Typography)`
            margin: 0px 12px;
`