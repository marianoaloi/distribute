const { execFile, execFileSync } = require("child_process");

const BIN = "ffmpegthumbnailer";

const argsFor = (input, output) => ["-s300", "-i", input, "-o", output, "-f"];

module.exports = {
    name: "ffmpegthumbnailer (system)",

    isAvailable: () => {
        try {
            execFileSync(BIN, ["-h"], { encoding: "UTF-8", stdio: "pipe" });
            return true;
        } catch {
            return false;
        }
    },

    generate: (input, output) => new Promise((resolve, reject) => {
        execFile(BIN, argsFor(input, output), { encoding: "UTF-8" }, (error) =>
            error ? reject(error) : resolve()
        );
    }),

    generateSync: (input, output) => {
        execFileSync(BIN, argsFor(input, output), { encoding: "UTF-8" });
    },
};
