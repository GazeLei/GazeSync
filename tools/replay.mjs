import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { replay } from "../dist/index.js";

const file = process.argv[2];
if (!file)
  throw new Error(
    "Usage: npm --prefix gaze-tools run replay -- /absolute/path/session.json",
  );
const recording = JSON.parse(await readFile(file, "utf8"));
const restored = replay(recording);
const exact = isDeepStrictEqual(restored.aligned, recording.aligned);
console.log(
  JSON.stringify(
    {
      schemaVersion: recording.schemaVersion,
      alignedSamples: restored.aligned.length,
      pendingSamples: restored.pending.length,
      replayExact: exact,
    },
    null,
    2,
  ),
);
if (!exact) process.exitCode = 1;
