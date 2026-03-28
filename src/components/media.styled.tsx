import styled from "@emotion/styled";
import { Typography } from "@mui/material";



export const title = styled(Typography)`

`

export const ImageMaloi = styled.img<{ size: number }>((props: any) => `
    max-width: ${props.size}px;
    max-height: ${props.size}px;
`)

export const CheckBoxSelect = styled.input`
  float: right;
  margin-right: -17px;
  transform: scale(3);
  right: 32px;
  top: 13px;
  position: relative;
  opacity: 80%;
`

export const ThePhoto = styled.div`
        display: unset;
`

export const PreviewMedia = styled.div<{ isVideo?: boolean }>((props: any) => `

  /* transform: scale(3); */
  background-color: ${props.isVideo ? "blue" : "red"};
  color: white;
  float: right;
  font-size: 17px;
  height: 20px;
  margin-right: -17px;
  opacity: 80%;
  padding: 2px;
  position: relative;
  right: 20px;
  text-align: center;
  top: 43px;
  width: 20px;

`)