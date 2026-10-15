import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
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

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
test("release: npm archive contains only reviewed package files", async () => {
  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const [packed] = JSON.parse(
    execFileSync("npm", ["pack", "--dry-run", "--json"], {
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
  assert.equal(
    pkg.private,
    !JSON.parse(await readFile(resolve(root, "release.json"), "utf8"))
      .publicationEnabled,
  );
  assert.equal(pkg.license, "GPL-3.0-only");
});

test("release: every declared import stays within the standalone package", async () => {
  const summary = await checkRelease(root);
  assert.equal(summary.runtimeDependencies, 0);
  assert.equal(
    summary.publicationEnabled,
    JSON.parse(await readFile(resolve(root, "release.json"), "utf8"))
      .publicationEnabled,
  );
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
