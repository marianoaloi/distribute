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

module.exports = {
    index,
    ensureReady,
    rebuildIndex,
};
