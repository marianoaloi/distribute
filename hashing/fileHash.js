const fs = require("fs");
const crypto = require("crypto");

const CHUNK_SIZE = 1024 * 1024;

// Caps how many files are being streamed/read for MD5 at once, independent
// of the frame-extraction semaphore in compareImg/videoFrames.js - hashing
// is a different resource (disk IO) and shouldn't share that limiter.
const FILE_HASH_CONCURRENCY = 4;

const createSemaphore = (limit) => {
    let active = 0;
    const queue = [];
    const acquire = () => {
        if (active < limit) {
            active++;
            return Promise.resolve();
        }
        return new Promise(resolve => queue.push(resolve)).then(() => { active++; });
    };
    const release = () => {
        active--;
        const next = queue.shift();
        if (next) next();
    };
    return { acquire, release };
};

const hashLimiter = createSemaphore(FILE_HASH_CONCURRENCY);

// Streamed so multi-GB video files never get fully loaded into memory.
// Resolves null (instead of throwing) on a locked/deleted file so callers can
// fall back to the path-hash thumbnail name rather than failing the load.
const fileMd5 = async (filePath) => {
    await hashLimiter.acquire();
    try {
        return await new Promise((resolve) => {
            const hash = crypto.createHash("md5");
            const stream = fs.createReadStream(filePath, { highWaterMark: CHUNK_SIZE });
            stream.on("data", (chunk) => hash.update(chunk));
            stream.on("end", () => resolve(hash.digest("hex")));
            stream.on("error", () => resolve(null));
        });
    } finally {
        hashLimiter.release();
    }
};

// Synchronous counterpart for the FixFiles/recursive-load path - loops a
// reused buffer through fs.readSync instead of fs.readFileSync so a large
// video doesn't get slurped into memory whole.
const fileMd5Sync = (filePath) => {
    let fd;
    try {
        fd = fs.openSync(filePath, "r");
    } catch {
        return null;
    }
    try {
        const hash = crypto.createHash("md5");
        const buffer = Buffer.alloc(CHUNK_SIZE);
        let bytesRead;
        do {
            bytesRead = fs.readSync(fd, buffer, 0, CHUNK_SIZE, null);
            if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
        } while (bytesRead > 0);
        return hash.digest("hex");
    } catch {
        return null;
    } finally {
        fs.closeSync(fd);
    }
};

module.exports = {
    fileMd5,
    fileMd5Sync,
    FILE_HASH_CONCURRENCY,
};
