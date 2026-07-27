import styled from "@emotion/styled";

export const DetectionResume = styled.div`
    position: sticky;
    top: 0px;
    left: 0px;
    right: 0px;
    width: 100%;
    box-sizing: border-box;
    background: rgba(30, 34, 43, 0.95);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    display: flex;
    min-height: 48px;
    height: auto;
    align-items: center;
    flex-wrap: wrap;
    justify-content: flex-start;
    padding: 8px 16px;
    gap: 12px;
    z-index: 4;
    color: #e0e0e0;

    .MuiIconButton-root {
        color: rgba(255, 255, 255, 0.7);
        transition: color 0.2s, background-color 0.2s;

        &:hover {
            color: #fff;
            background-color: rgba(255, 255, 255, 0.08);
        }
    }

    .spacer {
        flex-grow: 1;
    }
`

export const DetectionGridWrap = styled.div`
    display: flex;
    flex-flow: wrap;
    align-items: flex-start;
    place-content: flex-start space-around;
    margin: 12px 0px;
    gap: 8px;
`

export const DetectionTile = styled.div<{ size: number }>((props: any) => `
    position: relative;
    display: inline-block;
    max-width: ${props.size}px;
    max-height: ${props.size}px;

    img {
        max-width: ${props.size}px;
        max-height: ${props.size}px;
        display: block;
    }
`)

export const DetectionBoxOutline = styled.div<{ x: number, y: number, w: number, h: number }>((props: any) => `
    position: absolute;
    left: ${props.x * 100}%;
    top: ${props.y * 100}%;
    width: ${props.w * 100}%;
    height: ${props.h * 100}%;
    border: 2px solid #00e676;
    box-sizing: border-box;
    pointer-events: none;
`)

export const DetectionBoxLabel = styled.div`
    position: absolute;
    left: 0;
    top: -18px;
    background: #00e676;
    color: #10201a;
    font-size: 11px;
    line-height: 16px;
    padding: 0 4px;
    white-space: nowrap;
    border-radius: 2px 2px 0 0;
`

export const EmptyState = styled.div`
    margin: 32px;
    color: rgba(255, 255, 255, 0.6);
`
