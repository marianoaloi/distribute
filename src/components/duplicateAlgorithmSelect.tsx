import { ToggleButton, ToggleButtonGroup } from "@mui/material"
import { DuplicateAlgorithm } from "../lib/redux"

export const ALGORITHM_LABELS: Record<DuplicateAlgorithm, string> = {
    pixel: "Pixel",
    objects: "Objects",
    blur: "Blur",
}

export const ALGORITHM_SCAN_TITLES: Record<DuplicateAlgorithm, string> = {
    pixel: "Scan indexed media for visual duplicates (perceptual hash)",
    objects: "Find media sharing the same detected object (same class and box)",
    blur: "Find media sharing the same blur hash",
}

export const ALGORITHM_GROUP_LABELS: Record<DuplicateAlgorithm, string> = {
    pixel: "identical files",
    objects: "files sharing a detected object",
    blur: "files with same blur hash",
}

export const ALGORITHM_EMPTY_TEXTS: Record<DuplicateAlgorithm, string> = {
    pixel: "No duplicates found yet. Click the scan button to compare the loaded media by content.",
    objects: "No media share a detected object. Run object detection first, then click the scan button.",
    blur: "No media share a blur hash. Click the scan button to search again.",
}

// The toolbar background is dark, so the default grey toggle is barely visible:
// bright cyan outline/text, and a solid bright fill for the selected algorithm.
const toggleSx = {
    color: "#4dd0ff",
    borderColor: "rgba(77, 208, 255, 0.6)",
    fontWeight: 600,
    "&:hover": { backgroundColor: "rgba(77, 208, 255, 0.15)" },
    "&.Mui-selected, &.Mui-selected:hover": { color: "#0b1220", backgroundColor: "#4dd0ff" },
    "&.Mui-disabled": { color: "rgba(77, 208, 255, 0.35)", borderColor: "rgba(77, 208, 255, 0.25)" },
}

interface Props {
    value: DuplicateAlgorithm
    onChange: (algorithm: DuplicateAlgorithm) => void
    disabled?: boolean
}

// Picks which duplicate-detection algorithm the grid shows and the scan button runs.
export const DuplicateAlgorithmSelect = ({ value, onChange, disabled }: Props) => (
    <ToggleButtonGroup size="small" exclusive value={value} disabled={disabled}
        onChange={(_, next: DuplicateAlgorithm | null) => { if (next) onChange(next) }}>
        {(Object.keys(ALGORITHM_LABELS) as DuplicateAlgorithm[]).map(algorithm => (
            <ToggleButton key={algorithm} value={algorithm} title={ALGORITHM_SCAN_TITLES[algorithm]} sx={toggleSx}>
                {ALGORITHM_LABELS[algorithm]}
            </ToggleButton>
        ))}
    </ToggleButtonGroup>
)
