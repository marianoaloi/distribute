const { LocalIndex } = require("vectra");
const { indexDir } = require("./cache");

const index = new LocalIndex(indexDir);
let readyPromise;

const ensureReady = () => {
    if (!readyPromise) {
        readyPromise = index.isIndexCreated().then(created => {
            if (!created) return index.createIndex();
        });
    }
    return readyPromise;
};

module.exports = {
    index,
    ensureReady,
};
