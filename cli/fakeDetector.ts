// Deterministic stand-in for objectDetection/onnxDetector, so the detect
// stage (and the detection-based duplicate algorithms) can be exercised by
// tests without an ONNX model. cli/lsr.ts only uses it when BOTH
// NODE_ENV=test and LSR_FAKE_DETECTOR=1 are set.
//
// Every readable file gets one box whose class and geometry derive from its
// byte size, so byte-identical files get identical boxes.
import fs from "fs";
import type { DetectionBox } from "../types/domain";
import type { DetectorLike } from "../pipeline/superPipeline";

export const FAKE_CLASS_NAMES = ["fake-a", "fake-b"];
export const FAKE_MODEL_PATH = "lsr-fake-detector.onnx";
// File-name markers that make the fake detector misbehave (tests only).
export const POISON_REJECT = "__lsr_reject__";
export const POISON_THROW = "__lsr_throw__";
// Never resolves: a hung item, for the stall watchdog test.
export const POISON_HANG = "__lsr_hang__";

export const isFakeDetectorRequested = (env: NodeJS.ProcessEnv = process.env): boolean =>
    env.NODE_ENV === "test" && env.LSR_FAKE_DETECTOR === "1";

export const createFakeDetector = (): DetectorLike => ({
    isAvailable: () => true,
    getClassNames: () => FAKE_CLASS_NAMES,
    getModelPath: () => FAKE_MODEL_PATH,
    detect: async (imagePath: string): Promise<DetectionBox[]> => {
        // Poison files for the runner's error-handling tests: an error that
        // escapes every handler while this file is in flight.
        if (imagePath.includes(POISON_REJECT)) void Promise.reject(new Error(`fake detector: unhandled rejection on ${imagePath}`));
        if (imagePath.includes(POISON_THROW)) {
            setImmediate(() => { throw new Error(`fake detector: uncaught exception on ${imagePath}`); });
            // Stay in flight until the throw has happened.
            await new Promise<void>(resolve => setTimeout(resolve, 50));
        }
        if (imagePath.includes(POISON_HANG)) await new Promise<never>(() => undefined);
        const size = (await fs.promises.stat(imagePath)).size;
        const classId = size % FAKE_CLASS_NAMES.length;
        return [{
            classId,
            className: FAKE_CLASS_NAMES[classId],
            score: 0.5 + (size % 50) / 100,
            x: (size % 100) / 100,
            y: (size % 70) / 100,
            w: 0.1,
            h: 0.1,
        }];
    },
});
