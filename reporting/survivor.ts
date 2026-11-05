// Which member of a duplicate group to keep. Pure and import-free so both the
// headless LSR report (reporting/report.ts) and jest can load it.
//
// KEEP IN SYNC with src/components/duplicatesGrid.tsx's
// selectDuplicatesToRemove (CRA cannot import modules outside src/ in app
// code, so the renderer keeps its own copy of the rule):
//   1. videos (mime contains "video") that have audio, else
//   2. any video, else
//   3. gifs (mime contains "gif"), else
//   4. every member;
//   then the biggest file among those candidates wins.
// Tie-break on equal size: the grid keeps whichever comes first in group
// order; here the lexicographically smallest id wins instead, so a report is
// reproducible regardless of row order. Identical for every non-tie.
export interface SurvivorCandidate {
    id: string;
    mime: string;
    size: number;
    hasAudio: boolean;
}

export const survivorCandidates = <T extends SurvivorCandidate>(group: readonly T[]): T[] => {
    const videos = group.filter(m => m.mime.includes("video"));
    const soundedVideos = videos.filter(m => m.hasAudio);
    const gifs = group.filter(m => m.mime.includes("gif"));
    return soundedVideos.length > 0 ? soundedVideos
        : videos.length > 0 ? videos
        : gifs.length > 0 ? gifs
        : [...group];
};

export const pickSurvivor = <T extends SurvivorCandidate>(group: readonly T[]): T | undefined => {
    const candidates = survivorCandidates(group);
    if (candidates.length === 0) return undefined;
    return candidates.reduce((a, b) => (b.size > a.size || (b.size === a.size && b.id < a.id)) ? b : a);
};
