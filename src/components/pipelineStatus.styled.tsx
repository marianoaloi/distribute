import styled from "@emotion/styled";
import { keyframes } from "@emotion/react";

const pulse = keyframes`
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
`;

export const PipelineBar = styled.div`
    position: absolute;
    bottom: 0px;
    left: 0px;
    right: 0px;
    width: calc(100% - 130px);
    box-sizing: border-box;
    background: rgba(20, 24, 32, 0.97);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
    display: flex;
    flex-direction: column;
    padding: 6px 16px 8px;
    gap: 4px;
    z-index: 11;
    color: #e0e0e0;
`

export const PipelineTopRow = styled.div`
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
`

// The one piece of UI whose entire job is reassuring the user the process
// hasn't silently died - a still frame (spinner or static text) reads the
// same whether the app is mid-work or hung, a pulse doesn't.
export const LiveDot = styled.span`
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #4caf50;
    flex: none;
    animation: ${pulse} 1.4s ease-in-out infinite;
`

export const StageLabel = styled.span`
    font-weight: 600;
`

export const StageCounter = styled.span`
    color: rgba(255, 255, 255, 0.6);
`

export const EtaGroup = styled.span`
    margin-left: auto;
    display: flex;
    gap: 16px;
    color: rgba(255, 255, 255, 0.6);
    font-variant-numeric: tabular-nums;
`
