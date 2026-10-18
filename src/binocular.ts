import type { AlignedGaze } from "./types.js";
import { finite } from "./geometry.js";
export interface EyePair {
  left: AlignedGaze | null;
  right: AlignedGaze | null;
  skewMs: number | null;
}

/** Offline chronological one-to-one pairing. No averaging, reuse, or cross-epoch fusion. */
export function pairEyes(
  samples: readonly AlignedGaze[],
  { maxSkewMs = 5 }: { maxSkewMs?: number } = {},
): EyePair[] {
  finite(maxSkewMs, "maxSkewMs");
  if (maxSkewMs < 0) throw new RangeError("maxSkewMs cannot be negative");
  const groups = new Map<
    string,
    { left: AlignedGaze[]; right: AlignedGaze[] }
  >();
  for (const s of samples) {
    if (!s.usable || (s.eye !== "left" && s.eye !== "right")) continue;
    const key = JSON.stringify([
      s.sourceId,
      s.type,
      s.clockId,
      s.clockEpoch,
      s.surfaceId,
      s.surfaceEpoch,
      s.contentId ?? null,
      s.calibrationId ?? null,
    ]);
    if (!groups.has(key)) groups.set(key, { left: [], right: [] });
    groups.get(key)![s.eye].push(s);
  }
  const result: EyePair[] = [];
  for (const group of groups.values()) {
    group.left.sort((a, b) => a.captureTimeMs - b.captureTimeMs);
    group.right.sort((a, b) => a.captureTimeMs - b.captureTimeMs);
    let l = 0,
      r = 0;
    while (l < group.left.length || r < group.right.length) {
      const left = group.left[l],
        right = group.right[r];
      if (
        left &&
        right &&
        Math.abs(left.captureTimeMs - right.captureTimeMs) <= maxSkewMs
      ) {
        result.push({
          left,
          right,
          skewMs: right.captureTimeMs - left.captureTimeMs,
        });
        l++;
        r++;
      } else if (left && (!right || left.captureTimeMs < right.captureTimeMs)) {
        result.push({ left, right: null, skewMs: null });
        l++;
      } else {
        result.push({ left: null, right, skewMs: null });
        r++;
      }
    }
  }
  result.sort(
    (a, b) =>
      (a.left?.captureTimeMs ?? a.right!.captureTimeMs) -
      (b.left?.captureTimeMs ?? b.right!.captureTimeMs),
  );
  return structuredClone(result);
}
