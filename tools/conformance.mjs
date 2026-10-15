import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  existsSync,
  mkdtempSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  generateExperiment,
  executeExperiment,
  summarizeExperiment,
} from "../dist/experiments.js";
import {
  ModelAdapter,
  TobiiProAdapter,
  EyeLinkAdapter,
  PupilCoreAdapter,
} from "../dist/adapters.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const python =
  process.env.GAZESYNC_PYTHON ??
  (existsSync(resolve(root, ".venv/bin/python"))
    ? resolve(root, ".venv/bin/python")
    : "python3");
const transport = mkdtempSync(resolve(tmpdir(), "gazesync-conformance-"));
process.on("exit", () => rmSync(transport, { recursive: true, force: true }));
const runPython = (args, input) => {
  if (input !== undefined) {
    const path = resolve(transport, "input.json");
    writeFileSync(path, JSON.stringify(input));
    args = args.map((value) => (value === "-" ? path : value));
  }
  const output = resolve(transport, "output.json"),
    fd = openSync(output, "w");
  let result;
  try {
    result = spawnSync(python, ["-m", "gazesync", ...args], {
      cwd: root,
      stdio: ["ignore", fd, "pipe"],
      encoding: "utf8",
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    });
  } finally {
    closeSync(fd);
  }
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return JSON.parse(readFileSync(output, "utf8"));
};
function compare(
  a,
  b,
  path = "root",
  state = { maxDifference: 0 },
  atol = 1e-8,
) {
  if (typeof a === "number" && typeof b === "number") {
    const delta = Math.abs(a - b);
    state.maxDifference = Math.max(state.maxDifference, delta);
    if (
      !Number.isFinite(delta) ||
      delta > atol + 1e-12 * Math.max(Math.abs(a), Math.abs(b))
    )
      throw new Error(`${path}: ${a} != ${b}`);
  } else if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length)
      throw new Error(`${path}: lengths ${a.length} != ${b.length}`);
    a.forEach((v, i) => compare(v, b[i], `${path}[${i}]`, state, atol));
  } else if (a && b && typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a).sort(),
      bk = Object.keys(b).sort();
    if (JSON.stringify(ak) !== JSON.stringify(bk))
      throw new Error(
        `${path}: keys differ ${JSON.stringify(ak)} vs ${JSON.stringify(bk)}`,
      );
    for (const key of ak)
      compare(a[key], b[key], `${path}.${key}`, state, atol);
  } else if (a !== b) throw new Error(`${path}: ${a} != ${b}`);
  return state;
}
const fixture = JSON.parse(
  await readFile(resolve(root, "contracts/adapter-fixtures.json"), "utf8"),
);
const classes = {
  model: ModelAdapter,
  tobii: TobiiProAdapter,
  eyelink: EyeLinkAdapter,
  pupil: PupilCoreAdapter,
};
const normalized = fixture.cases.map((c) => {
  const adapter = new classes[c.adapter]({ ...fixture.base, ...c.options });
  return {
    name: c.name,
    source: adapter.source,
    results: c.packets.map((p) =>
      c.method === "surface" ? adapter.adaptSurface(p) : adapter.adapt(p),
    ),
  };
});
compare(
  normalized,
  runPython(["normalize-fixtures", "contracts/adapter-fixtures.json"]),
);

const full = process.argv.includes("--full"),
  cases = [];
const displays = full ? [30, 60, 90, 120, 144, 240] : [60, 144],
  gazes = full ? [30, 60, 120, 250, 600, 1000, 2000] : [30, 250, 2000];
for (const displayHz of displays)
  for (const gazeHz of gazes)
    cases.push({
      name: `rate-${displayHz}-${gazeHz}`,
      width: 1280,
      height: 720,
      displayHz,
      inputHz: 240,
      gazeHz,
      mode: "binocular-independent",
    });
const screens = full
  ? [
      [320, 568, 2],
      [390, 844, 3],
      [412, 915, 2.625],
      [844, 390, 3],
      [1024, 768, 1],
      [1920, 1080, 1],
      [2560, 1440, 1.5],
      [3440, 1440, 1],
      [3840, 2160, 2],
    ]
  : [
      [390, 844, 3],
      [3840, 2160, 2],
    ];
const modes = [
  "monocular-left",
  "monocular-right",
  "binocular-independent",
  "binocular-fused",
];
for (let i = 0; i < screens.length; i++)
  for (const mode of modes) {
    const [width, height, devicePixelRatio] = screens[i];
    cases.push({
      name: `screen-${width}-${height}-${mode}`,
      width,
      height,
      devicePixelRatio,
      displayHz: [30, 60, 90, 120, 144, 240][i % 6],
      inputHz: [30, 60, 125, 240, 1000][i % 5],
      gazeHz: 600,
      rightGazeHz: 120,
      mode,
      rotateMidway: i % 2 === 0,
      independentClocks: mode === "binocular-independent",
    });
  }
const rows = [];
let maxDifference = 0,
  total = 0,
  maxViewportDifferencePx = 0,
  maxContentDifferenceUnits = 0,
  maxTimeDifferenceMs = 0;
for (const config of cases) {
  const experiment = generateExperiment(config),
    session = executeExperiment(experiment),
    summary = summarizeExperiment(experiment, session);
  const other = runPython(["align-events", "-", "--aligned-only"], experiment);
  const compared = compare(session.aligned, other.aligned);
  let viewportDifferencePx = 0,
    contentDifferenceUnits = 0,
    timeDifferenceMs = 0;
  session.aligned.forEach((a, i) => {
    const b = other.aligned[i];
    timeDifferenceMs = Math.max(
      timeDifferenceMs,
      Math.abs(a.captureTimeMs - b.captureTimeMs),
    );
    if (a.viewportPoint && b.viewportPoint)
      viewportDifferencePx = Math.max(
        viewportDifferencePx,
        Math.hypot(
          a.viewportPoint.x - b.viewportPoint.x,
          a.viewportPoint.y - b.viewportPoint.y,
        ),
      );
    if (a.contentPoint && b.contentPoint)
      contentDifferenceUnits = Math.max(
        contentDifferenceUnits,
        Math.hypot(
          a.contentPoint.x - b.contentPoint.x,
          a.contentPoint.y - b.contentPoint.y,
        ),
      );
  });
  compare(session.diagnostics.report(), other.diagnostics);
  if (
    summary.samples !== summary.expectedSamples ||
    summary.frameMismatches ||
    summary.maxReconstructionErrorPx > 1e-6 ||
    !summary.replayExact ||
    summary.pendingSamples ||
    other.pendingSamples
  )
    throw new Error(`Experiment failed: ${config.name}`);
  total += summary.samples;
  maxDifference = Math.max(maxDifference, compared.maxDifference);
  maxViewportDifferencePx = Math.max(
    maxViewportDifferencePx,
    viewportDifferencePx,
  );
  maxContentDifferenceUnits = Math.max(
    maxContentDifferenceUnits,
    contentDifferenceUnits,
  );
  maxTimeDifferenceMs = Math.max(maxTimeDifferenceMs, timeDifferenceMs);
  rows.push({
    ...summary,
    crossLanguageMaxDifference: compared.maxDifference,
    crossLanguageViewportDifferencePx: viewportDifferencePx,
    crossLanguageContentDifferenceUnits: contentDifferenceUnits,
    crossLanguageTimeDifferenceMs: timeDifferenceMs,
  });
  if (rows.length % 10 === 0)
    console.error(`Validated ${rows.length}/${cases.length} cases`);
}
const output = {
  schemaVersion: "2.0",
  implementationVersion: "0.3.0",
  adapterCases: fixture.cases.length,
  experimentCases: rows.length,
  totalSamples: total,
  maxCrossLanguageDifference: maxDifference,
  maxViewportDifferencePx,
  maxContentDifferenceUnits,
  maxTimeDifferenceMs,
  allPassed: true,
  rows,
};
await mkdir(resolve(root, "artifacts/validation"), { recursive: true });
await writeFile(
  resolve(
    root,
    `artifacts/validation/${full ? "full" : "quick"}-conformance.json`,
  ),
  JSON.stringify(output, null, 2) + "\n",
);
console.log(JSON.stringify({ ...output, rows: undefined }, null, 2));
