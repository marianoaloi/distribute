
import { FileDTO } from "../../../../entity/FileDTO";
import { Media } from "../../../../entity/Media"


const getAll = async (paths: FileDTO[]): Promise<Media[]> => {

    let indexPath = 0;
    return paths.map(f => { return { "id": indexPath++, "path": f.item, size: f.size, media: f.fileName, mime: f.mime, checked: false, deleted: false } as Media });
}


export const MediaService = {
    getAll //, ignoreJob, appliedByMeJob, getText
}