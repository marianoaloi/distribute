export interface Media {
    id: string
    path: string
    media: string
    filename: string
    mime: string
    checked: boolean
    deleted: boolean
    size: number
    screenIndex: number
    hash: string
    hasAudio: boolean
    // True only for transient "fake" items streamed in by the database
    // import feature: they represent a duplicate living in ANOTHER folder,
    // exist purely to inform the move decision, and are never moved or
    // written into this folder's index. All real items carry false.
    imported: boolean
}