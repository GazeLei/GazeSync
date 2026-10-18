import { readFile, writeFile, mkdir } from "node:fs/promises";
import { generateExperiment, executeExperiment } from "../dist/experiments.js";
await mkdir("paper/data", { recursive: true });
const validation = JSON.parse(
  await readFile("artifacts/validation/full-conformance.json", "utf8"),
);
if (!validation.allPassed || validation.experimentCases !== 78)
  throw Error("Run the full conformance matrix first");
await writeFile(
  "paper/data/validation.json",
  JSON.stringify(validation, null, 2) + "\n",
);
const experiment = generateExperiment({
  name: "timing-figure",
  width: 1280,
  height: 720,
  displayHz: 60,
  inputHz: 240,
  gazeHz: 120,
  mode: "binocular-independent",
});
const session = executeExperiment(experiment);
const frames = experiment.events
  .filter((e) => e.type === "frame")
  .map((e) => e.payload);
const samples = session.aligned
  .filter((a) => a.eye === "left" && a.type === "pog2d" && a.contentPoint)
  .map((a) => {
    const truth = experiment.truth[`${a.eye}/${a.type}/${a.sampleId}`];
    const f = frames.filter((f) => f.t <= a.receivedTimeMs).at(-1);
    const naive = {
      x: (truth.viewport.x - f.view.tx) / f.view.scale,
      y: (truth.viewport.y - f.view.ty) / f.view.scale,
    };
    return {
      capture: a.captureTimeMs,
      arrival: a.receivedTimeMs,
      frame: a.presentationTimeMs,
      arrivalFrame: f.t,
      error:
        Math.hypot(
          a.contentPoint.x - truth.content.x,
          a.contentPoint.y - truth.content.y,
        ) * truth.scale,
      arrivalError:
        Math.hypot(naive.x - truth.content.x, naive.y - truth.content.y) *
        truth.scale,
    };
  });
await writeFile(
  "paper/data/timing.json",
  JSON.stringify(
    {
      description:
        "Synthetic representative trace; logical viewport-pixel residuals.",
      config: experiment.config,
      frames: frames.map((f) => ({ t: f.t, scale: f.view.scale })),
      samples,
    },
    null,
    2,
  ) + "\n",
);

await writeFile("paper/data/interaction-validation.json", await readFile("artifacts/validation/interaction-conformance.json"));
