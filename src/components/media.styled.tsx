import styled from "@emotion/styled";
import { Check, CheckBox } from "@mui/icons-material";
import { Typography } from "@mui/material";


export const title = styled(Typography)`

`

export const ImageMaloi = styled.img`
    max-width: 200px;
    max-height: 200px;
`

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

export const PreviewMedia = styled.div`

  float: right;
  margin-right: -17px;
  /* transform: scale(3); */
  right: 20px;
  top: 43px;
  position: relative;
  opacity: 80%;
  background-color: blue;
  color: white;
  padding: 2px;
  width: 20px;
  text-align: center;
  height: 20px;
  font-size: 17px;

`