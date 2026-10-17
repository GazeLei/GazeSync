import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const tool = fileURLToPath(new URL("../tools/overleaf.py", import.meta.url));
test("Overleaf sync previews, imports remote edits and refuses conflicts or symlink escapes", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "gazesync-overleaf-"));
  const root = resolve(dir, "source"),
    target = resolve(dir, "checkout");
  const files = [
    "paper/main.tex",
    "paper/tables/validation.tex",
    "paper/latexmkrc",
    "paper/OVERLEAF.txt",
    "NOTICE",
    ...["architecture", "timing", "geometry", "validation"].map(
      (n) => `paper/figures/${n}.pdf`,
    ),
  ];
  const call = (action, apply = false) =>
    JSON.parse(
      execFileSync(
        process.env.PYTHON ?? "python3",
        [
          tool,
          action,
          "--root",
          root,
          "--directory",
          target,
          ...(apply ? ["--apply"] : []),
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ),
    );
  try {
    for (const f of files) {
      await mkdir(dirname(resolve(root, f)), { recursive: true });
      await writeFile(resolve(root, f), `original ${f}`);
    }
    assert.equal(call("export").applied, false);
    await assert.rejects(readFile(resolve(target, "main.tex")), /ENOENT/);
    call("export", true);
    await writeFile(resolve(target, "main.tex"), "Overleaf edit");
    call("import", true);
    assert.equal(
      await readFile(resolve(root, "paper/main.tex"), "utf8"),
      "Overleaf edit",
    );
    await writeFile(resolve(root, "paper/main.tex"), "local concurrent edit");
    await writeFile(resolve(target, "main.tex"), "remote concurrent edit");
    assert.throws(() => call("import", true), /No files copied/);
    assert.equal(
      await readFile(resolve(root, "paper/main.tex"), "utf8"),
      "local concurrent edit",
    );
    assert.throws(() => call("export", true), /No files copied/);
    await rm(resolve(target, "main.tex"));
    await symlink(resolve(root, "paper/main.tex"), resolve(target, "main.tex"));
    assert.throws(() => call("import", true), /Symlinks/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
