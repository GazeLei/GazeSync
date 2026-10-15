import test from "node:test";
import assert from "node:assert/strict";
import {
  buildScenario,
  isScenarioPassing,
  runScenario,
} from "../dist/simulation.js";

for (const device of ["desktop", "mobile"]) {
  for (const seed of [1, 41, 90210]) {
    test(`${device} full interaction/replay with 2D/3D signals, delay, jitter, gaps; seed ${seed}`, () => {
      const { summary, scenario, recording } = runScenario(device, { seed });
      assert.equal(isScenarioPassing(summary), true);
      assert.equal(summary.frameMismatches, 0);
      assert.ok(
        summary.maxReconstructionErrorPx < 1e-7,
        JSON.stringify(summary),
      );
      assert.ok(summary.paired2D3DMaxDifferencePx < 1e-8);
      assert.ok(summary.meanInjectedGazeErrorPx < 0.8);
      assert.ok(summary.naiveArrivalMappingMeanErrorPx > 1);
      assert.equal(summary.replayExact, true);
      assert.equal(summary.pendingSamples, 0);
      assert.equal(summary.finalZoom, 1);
      assert.ok(summary.flagCounts.blink > 0);
      assert.ok(summary.flagCounts["late-arrival"] > 0);
      assert.ok(summary.flagCounts["low-confidence"] > 0);
      assert.equal(summary.flagCounts["surface-epoch-mismatch"], undefined);
      assert.equal(
        new Set(scenario.inputs.map((e) => e.id)).size,
        scenario.inputs.length,
      );
      if (device === "mobile") {
        assert.ok(scenario.inputs.some((e) => e.kind === "double-tap"));
        assert.ok(scenario.inputs.some((e) => e.reason === "pointer-cancel"));
        assert.ok(
          recording.aligned.every(
            (a) => a.captureTimeMs < 7300 || a.captureTimeMs >= 7800,
          ),
        );
      } else assert.ok(scenario.inputs.some((e) => e.kind === "box-zoom"));
    });
  }
}

test("simulation checks cannot certify empty, unmapped or non-finite results", () => {
  const { summary } = runScenario("desktop");
  for (const override of [
    { gazeSamples: 0 },
    { mappedSamples: 0 },
    { pairedSamples: 0 },
    { usableSamples: 0 },
    { expectedSamples: summary.gazeSamples + 1 },
    { maxReconstructionErrorPx: null },
    { maxReconstructionErrorPx: NaN },
    { paired2D3DMaxDifferencePx: Infinity },
  ]) {
    assert.equal(isScenarioPassing({ ...summary, ...override }), false);
  }
  assert.throws(() => buildScenario("desktop", { gazeHz: Infinity }), /finite/);
  assert.throws(() => buildScenario("mobile", { jitterMs: -1 }), /negative/);
});
