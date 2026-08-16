import styled from "@emotion/styled";
import { Typography } from "@mui/material";



export const title = styled(Typography)`

`

export const ImageMaloi = styled.img<{ size: number }>((props: any) => `
    max-width: ${props.size}px;
    max-height: ${props.size}px;
    min-height: ${props.size/1.3}px;
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
        position: relative;
`

export const PreviewMedia = styled.div<{ isVideo?: boolean , hasSound?: boolean, isGif?: boolean }>((props: any) => `

  /* transform: scale(3); */
  background-color: ${props.isGif ? "darkgreen" : props.isVideo ? props.hasSound ? "blue" : "deeppink" : "red"};
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

export const LastSeenStar = styled.div`
  color: white;
  -webkit-text-stroke: 1px black;
  font-size: 20px;
  height: 20px;
  line-height: 20px;
  opacity: 90%;
  pointer-events: none;
  position: absolute;
  right: 20px;
  text-align: center;
  top: 65px;
  width: 20px;
`