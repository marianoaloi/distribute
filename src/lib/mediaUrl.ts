export const toMediaUrl = (filePath: string): string => {
    // Placeholder graphics (e.g. an imported duplicate whose file no longer
    // exists on disk) arrive as inline data: URIs — nothing to load from disk.
    if (filePath.startsWith("data:")) return filePath
    return `local-media://${encodeURIComponent(filePath)}`
}
