export const toMediaUrl = (filePath: string): string => {
    return `local-media://${encodeURIComponent(filePath)}`
}
