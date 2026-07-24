const { LocalIndex } = require("vectra");
const { indexDir } = require("./cache");

const index = new LocalIndex(indexDir);
let readyPromise;

// Wipes and recreates an empty index.json. Used both to self-heal a
// corrupted index (truncated JSON, usually from a crash mid-write) and for
// the user-triggered "rebuild index" action.
const rebuildIndex = () => {
    readyPromise = index.createIndex({ version: 1, deleteIfExists: true });
    return readyPromise;
};

// isIndexCreated() only checks that index.json exists on disk, it doesn't
// parse it — so corruption is only caught once something actually reads the
// file. Probe it here, at startup, rather than letting the first real
// getItem/upsertItem call from the indexer surface the parse error.
const verifyIntegrity = () => index.listItems().catch(error => {
    console.error("compareImg: index corrupted, rebuilding:", error.message);
    return rebuildIndex();
});

const ensureReady = () => {
    if (!readyPromise) {
        readyPromise = index.isIndexCreated().then(created =>
            created ? verifyIntegrity() : index.createIndex()
        );
    }
    return readyPromise;
};

// vectra's LocalIndex keeps a single in-flight `_update` snapshot on the
// instance (beginUpdate/endUpdate); overlapping upsertItem calls race on it
// and either throw "Update already in progress" or silently clobber each
// other's writes. Concurrent indexing must serialize writes through here so
// the expensive work (ffmpeg, md5, embedding) can still run in parallel.
let writeQueue = Promise.resolve();
const upsertItem = (item) => {
    const result = writeQueue.then(() => index.upsertItem(item));
    writeQueue = result.then(() => {}, () => {});
    return result;
};

module.exports = {
    index,
    ensureReady,
    rebuildIndex,
    upsertItem,
};
