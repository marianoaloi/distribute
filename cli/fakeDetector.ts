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

export const isFakeDetectorRequested = (env: NodeJS.ProcessEnv = process.env): boolean =>
    env.NODE_ENV === "test" && env.LSR_FAKE_DETECTOR === "1";

export const createFakeDetector = (): DetectorLike => ({
    isAvailable: () => true,
    getClassNames: () => FAKE_CLASS_NAMES,
    getModelPath: () => FAKE_MODEL_PATH,
    detect: async (imagePath: string): Promise<DetectionBox[]> => {
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
