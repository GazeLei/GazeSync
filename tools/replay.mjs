import { readFile } from "node:fs/promises";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { replay } from "../dist/index.js";

const absoluteTolerance = 1e-8,
  relativeTolerance = 1e-12;
function closeGeometry(a, b) {
  if (typeof a === "number" || typeof b === "number")
    return (
      Number.isFinite(a) &&
      Number.isFinite(b) &&
      Math.abs(a - b) <=
        absoluteTolerance +
          relativeTolerance * Math.max(Math.abs(a), Math.abs(b))
    );
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, i) => closeGeometry(value, b[i]))
    );
  if (
    a !== null &&
    b !== null &&
    typeof a === "object" &&
    typeof b === "object"
  )
    return (
      isDeepStrictEqual(Object.keys(a).sort(), Object.keys(b).sort()) &&
      Object.keys(a).every((key) => closeGeometry(a[key], b[key]))
    );
  return a === b;
}
function crossLanguageMatch(actual, expected) {
  const geometry = new Set(["viewportPoint", "contentPoint", "rayHit"]);
  return (
    Array.isArray(expected) &&
    actual.length === expected.length &&
    actual.every((row, i) => {
      const other = expected[i];
      return (
        other !== null &&
        typeof other === "object" &&
        !Array.isArray(other) &&
        isDeepStrictEqual(Object.keys(row).sort(), Object.keys(other).sort()) &&
        Object.keys(row).every((key) =>
          geometry.has(key)
            ? closeGeometry(row[key], other[key])
            : isDeepStrictEqual(row[key], other[key]),
        )
      );
    })
  );
}
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { "cross-language": { type: "boolean", default: false } },
});
const file = positionals[0];
if (!file || positionals.length !== 1)
  throw new Error(
    "Usage: npm run replay -- /absolute/path/session.json [--cross-language]",
  );
const recording = JSON.parse(await readFile(file, "utf8"));
const restored = replay(recording);
const exact = isDeepStrictEqual(restored.aligned, recording.aligned);
const conformant =
  exact || crossLanguageMatch(restored.aligned, recording.aligned);
console.log(
  JSON.stringify(
    {
      schemaVersion: recording.schemaVersion,
      alignedSamples: restored.aligned.length,
      pendingSamples: restored.pending.length,
      replayExact: exact,
      replayConformant: conformant,
      comparison: values["cross-language"] ? "cross-language" : "exact",
      ...(values["cross-language"]
        ? {
            geometryTolerance: {
              absolute: absoluteTolerance,
              relative: relativeTolerance,
            },
          }
        : {}),
    },
    null,
    2,
  ),
);
if (!(values["cross-language"] ? conformant : exact)) {
  if (conformant)
    console.error(
      "Replayed geometry differs numerically; use --cross-language to check the documented geometry tolerance",
    );
  process.exitCode = 1;
}
