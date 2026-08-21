import styled from "@emotion/styled";

export const CollageWrap = styled.div<{ size: number }>((props: any) => `
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    gap: 1px;
    width: ${props.size}px;
    height: ${props.size}px;
    min-height: ${props.size / 1.3}px;
    overflow: hidden;
    background: #000;
    cursor: pointer;
`)

export const CollageFrame = styled.img`
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
`
