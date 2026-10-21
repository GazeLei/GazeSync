import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  copyFile,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDemoServer } from "../tools/server.mjs";
import { checkRelease } from "../tools/release-check.mjs";
import { GazeSession, createView } from "../dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// npm's Windows entry point is a command script, not a directly spawnable executable.
// Use its JS entry point without a shell so paths with spaces remain literal arguments.
const npmCli =
  process.env.npm_execpath ??
  (process.platform === "win32"
    ? resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")
    : undefined);
const runNpm = (args, options) =>
  npmCli
    ? execFileSync(process.execPath, [npmCli, ...args], options)
    : execFileSync("npm", args, options);

test("release: npm archive contains only reviewed package files", async () => {
  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const [packed] = JSON.parse(
    runNpm(["pack", "--dry-run", "--ignore-scripts", "--json"], {
      cwd: root,
      encoding: "utf8",
    }),
  );
  const allowed = new Set([...pkg.files, "package.json"]);
  assert.ok(packed.files.every((file) => allowed.has(file.path)));
  for (const name of allowed)
    assert.ok(
      packed.files.some((file) => file.path === name),
      name,
    );
  if (
    !JSON.parse(await readFile(resolve(root, "release.json"), "utf8"))
      .publicationEnabled
  )
    assert.equal(pkg.private, true);
  assert.equal(pkg.license, "GPL-3.0-only");
});

test("release: every declared import stays within the standalone package", async () => {
  const manifest = JSON.parse(
    await readFile(resolve(root, "public-files.json"), "utf8"),
  );
  assert.deepEqual(
    manifest.repositoryFiles.filter((name) => name.startsWith("paper/")),
    ["paper/GazeSync-implementation.pdf"],
  );
  const summary = await checkRelease(root);
  assert.equal(summary.runtimeDependencies, 0);
  assert.equal(
    summary.publicationEnabled,
    JSON.parse(await readFile(resolve(root, "release.json"), "utf8"))
      .publicationEnabled,
  );
});

test("release: publication gates allow a pending preprint and reject inconsistent metadata", async () => {
  const temp = await mkdtemp(resolve(tmpdir(), "gazesync-versions-"));
  try {
    const manifest = JSON.parse(
      await readFile(resolve(root, "public-files.json"), "utf8"),
    );
    for (const name of [
      ...manifest.repositoryFiles,
      ...manifest.generatedFiles,
    ]) {
      await mkdir(dirname(resolve(temp, name)), { recursive: true });
      await copyFile(resolve(root, name), resolve(temp, name));
    }
    const releasePath = resolve(temp, "release.json");
    const release = JSON.parse(await readFile(releasePath, "utf8"));
    const enabled = {
      ...release,
      publicationEnabled: true,
      authorsFinalized: true,
      implementationArxivId: null,
    };
    // Exercise the closed gate even when the checkout is an approved Python release.
    await writeFile(
      releasePath,
      JSON.stringify({ ...release, publicationEnabled: false }),
    );
    await assert.rejects(
      checkRelease(temp, { publication: true, registry: "pypi" }),
      /Public release is disabled/,
    );
    for (const value of ["false", "true", 1, null]) {
      await writeFile(
        releasePath,
        JSON.stringify({ ...release, publicationEnabled: value }),
      );
      await assert.rejects(
        checkRelease(temp, { publication: true, registry: "pypi" }),
        /publicationEnabled must be boolean/,
      );
    }
    for (const value of ["false", "true", 1, null]) {
      await writeFile(
        releasePath,
        JSON.stringify({ ...enabled, authorsFinalized: value }),
      );
      await assert.rejects(
        checkRelease(temp),
        /authorsFinalized must be boolean/,
      );
    }
    await writeFile(releasePath, JSON.stringify(enabled));
    assert.equal(
      (await checkRelease(temp, { publication: true, registry: "pypi" }))
        .publicationEnabled,
      true,
    );
    assert.equal(
      (await checkRelease(temp, { publication: true, registry: "testpypi" }))
        .publicationEnabled,
      true,
    );
    await writeFile(
      releasePath,
      JSON.stringify({ ...enabled, authorsFinalized: false }),
    );
    await assert.rejects(
      checkRelease(temp, { publication: true, registry: "pypi" }),
      /Public release is disabled/,
    );
    await writeFile(
      releasePath,
      JSON.stringify({ ...enabled, implementationArxivId: "pending" }),
    );
    await assert.rejects(checkRelease(temp), /optional arXiv identifier/);
    await writeFile(releasePath, JSON.stringify(enabled));
    await assert.rejects(
      checkRelease(temp, { publication: true, registry: "npm" }),
      /Public release is disabled/,
    );
    await assert.rejects(
      checkRelease(temp, { publication: true, registry: "unknown" }),
      /Unknown publication registry/,
    );
    const pkgPath = resolve(temp, "package.json"),
      candidate = JSON.parse(await readFile(pkgPath, "utf8"));
    await writeFile(pkgPath, JSON.stringify({ ...candidate, private: false }));
    assert.equal(
      (await checkRelease(temp, { publication: true, registry: "npm" }))
        .publicationEnabled,
      true,
    );
    await writeFile(
      pkgPath,
      JSON.stringify({
        ...candidate,
        publishConfig: {
          registry: "https://example.invalid/",
          access: "public",
        },
      }),
    );
    await assert.rejects(checkRelease(temp), /publication destination/);
    await writeFile(
      pkgPath,
      JSON.stringify({
        ...candidate,
        scripts: { ...candidate.scripts, postinstall: "node unexpected.js" },
      }),
    );
    await assert.rejects(checkRelease(temp), /installation hook/);
    await writeFile(pkgPath, JSON.stringify(candidate));
    const name = resolve(temp, "python/src/gazesync/version.py");
    await writeFile(
      name,
      (await readFile(name, "utf8")).replace(
        /IMPLEMENTATION_VERSION = "[^"]+"/,
        'IMPLEMENTATION_VERSION = "0.0.0"',
      ),
    );
    await assert.rejects(checkRelease(temp), /versions must agree/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("release: demo server refuses non-allowlisted documents and symlink escapes", async () => {
  const temp = await mkdtemp(resolve(tmpdir(), "gazesync-server-"));
  const app = resolve(temp, "app");
  await mkdir(resolve(app, "demo"), { recursive: true });
  await writeFile(resolve(app, "demo/index.html"), "<h1>Public demo</h1>");
  await writeFile(resolve(app, "draft.tex"), "PRIVATE TEST SENTINEL");
  await writeFile(resolve(temp, "outside.js"), "PRIVATE TEST SENTINEL");
  await symlink(resolve(temp, "outside.js"), resolve(app, "demo/escape.js"));
  await writeFile(
    resolve(app, "public-files.json"),
    JSON.stringify({
      schemaVersion: 1,
      repositoryFiles: ["demo/index.html", "demo/escape.js"],
      webFiles: ["demo/index.html", "demo/escape.js"],
    }),
  );
  const server = await createDemoServer(app);
  try {
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    const url = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(url + "/demo/")).status, 200);
    assert.equal((await fetch(url + "/draft.tex")).status, 404);
    assert.equal((await fetch(url + "/demo/escape.js")).status, 404);
    assert.equal((await fetch(url + "/%2e%2e%2foutside.js")).status, 404);
    assert.equal((await fetch(url + "/demo/", { method: "POST" })).status, 405);
    const head = await fetch(url + "/demo/", { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  } finally {
    await new Promise((done) => server.close(done));
    await rm(temp, { recursive: true, force: true });
  }
});

test("release: Python and npm archives enforce reviewed inventory and bytes", () => {
  execFileSync("python3", ["tools/test_package_smoke.py"], {
    cwd: root,
    encoding: "utf8",
  });
});

test("release: a tarball-installed consumer resolves ESM and TypeScript exports independently of the checkout", async () => {
  const temp = await mkdtemp(resolve(tmpdir(), "gazesync-npm-consumer-"));
  try {
    const [packed] = JSON.parse(
      runNpm(
        ["pack", "--ignore-scripts", "--json", "--pack-destination", temp],
        { cwd: root, encoding: "utf8" },
      ),
    );
    await writeFile(
      resolve(temp, "package.json"),
      '{"private":true,"type":"module"}',
    );
    runNpm(
      [
        "install",
        "--no-audit",
        "--no-fund",
        "--omit=dev",
        resolve(temp, packed.filename),
      ],
      { cwd: temp, encoding: "utf8" },
    );
    const report = JSON.parse(
      execFileSync(
        process.execPath,
        [resolve(root, "tools/npm_consumer_check.mjs"), temp],
        { cwd: temp, encoding: "utf8" },
      ),
    );
    assert.equal(report.esmImports, 4);
    assert.equal(report.installedTypeChecks.length, 3);
    assert.equal(report.replayExact, true);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("audit: replay CLI allows only explicit cross-language geometry tolerance", async () => {
  const folder = await mkdtemp(resolve(tmpdir(), "gazesync-cli-replay-"));
  try {
    const session = new GazeSession();
    session.present({
      t: 0,
      view: createView({
        width: 100,
        height: 100,
        contentWidth: 100,
        contentHeight: 100,
      }),
      surface: { id: "screen", epoch: "1" },
    });
    session.gaze(
      {
        id: "gaze",
        sourceId: "source",
        clockId: "session",
        clockEpoch: "0",
        surfaceId: "screen",
        surfaceEpoch: "1",
        eye: "left",
        type: "pog2d",
        space: "viewport",
        point: { x: 50, y: 50 },
        timeMs: 20,
        confidence: 1,
        valid: true,
      },
      21,
    );
    session.flush(100);
    const original = session.export(),
      file = resolve(folder, "session.json");
    const rounded = structuredClone(original);
    rounded.aligned[0].contentPoint.x += 1e-10;
    await writeFile(file, JSON.stringify(rounded));
    const run = (extra = []) =>
      execFileSync(
        process.execPath,
        [resolve(root, "tools/replay.mjs"), file, ...extra],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    assert.throws(() => run());
    const report = JSON.parse(run(["--cross-language"]));
    assert.equal(report.replayExact, false);
    assert.equal(report.replayConformant, true);
    for (const change of [
      (row) => {
        row.contentPoint.x += 1;
      },
      (row) => {
        row.captureTimeMs += 1e-10;
      },
      (row) => {
        row.frameId = "different-frame";
      },
      (row) => {
        row.usable = 1;
      },
      (row) => {
        row.flags.push("off-content");
      },
    ]) {
      const altered = structuredClone(original);
      change(altered.aligned[0]);
      await writeFile(file, JSON.stringify(altered));
      assert.throws(() => run(["--cross-language"]));
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
