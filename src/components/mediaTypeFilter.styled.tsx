import styled from "@emotion/styled";

export const FilterBar = styled.div`
    position: fixed;
    bottom: 16px;
    right: 16px;
    background: rgba(30, 34, 43, 0.95);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 50%;
    z-index: 1001;
    display: flex;
    width: 48px;
    height: 48px;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    transition: transform 0.2s, background-color 0.2s;

    &:hover {
        background: rgba(40, 45, 55, 0.98);
        transform: translateY(-2px);
    }

    .MuiIconButton-root {
        color: rgba(255, 255, 255, 0.8);
        transition: color 0.2s, background-color 0.2s;

        &:hover {
            color: #fff;
            background-color: transparent;
        }
    }
`
