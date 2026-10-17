import { readFile } from "node:fs/promises";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { publicManifest, reviewedFile } from "./files.mjs";
import { IMPLEMENTATION_VERSION, SCHEMA_VERSION } from "../dist/version.js";

/** Verify the explicit source boundary and release metadata; never publish. */
export async function checkRelease(root, { publication = false } = {}) {
  const manifest = await publicManifest(root);
  const names = new Set([
    ...manifest.repositoryFiles,
    ...manifest.generatedFiles,
  ]);
  const json = async (name) =>
    JSON.parse(await readFile(await reviewedFile(root, name), "utf8"));
  const pkg = await json("package.json"),
    release = await json("release.json"),
    paper = await json("paper/metadata.json");
  const py = await readFile(
    await reviewedFile(root, "python/pyproject.toml"),
    "utf8",
  );
  const pythonConstants = await readFile(
    await reviewedFile(root, "python/src/gazesync/version.py"),
    "utf8",
  );
  const pythonValue = (key) =>
    pythonConstants.match(new RegExp(`^${key} = ["']([^"']+)["']$`, "m"))?.[1];
  const lock = await json("package-lock.json");
  if (
    pkg.version !== IMPLEMENTATION_VERSION ||
    release.version !== pkg.version ||
    paper.implementationVersion !== pkg.version ||
    !py.includes(`version = "${pkg.version}"`) ||
    pythonValue("IMPLEMENTATION_VERSION") !== pkg.version ||
    pythonValue("SCHEMA_VERSION") !== SCHEMA_VERSION ||
    paper.schemaVersion !== SCHEMA_VERSION ||
    lock.version !== pkg.version ||
    lock.packages?.[""]?.version !== pkg.version
  )
    throw new Error(
      "Implementation, schema, npm lock, Python and release versions must agree",
    );
  if (
    pkg.license !== "GPL-3.0-only" ||
    !py.includes('license = "GPL-3.0-only"')
  )
    throw new Error("Expected GPL-3.0-only metadata");
  const license = await readFile(await reviewedFile(root, "LICENSE"), "utf8");
  if (
    !license.includes("GNU GENERAL PUBLIC LICENSE") ||
    !license.includes("Version 3, 29 June 2007") ||
    license.length < 35000
  )
    throw new Error("Full GPLv3 text is required");
  if (
    license !==
    (await readFile(await reviewedFile(root, "python/LICENSE"), "utf8"))
  )
    throw new Error("Python license differs");
  if (
    Object.keys(pkg.dependencies ?? {}).length ||
    !py.includes("dependencies = []")
  )
    throw new Error("Unexpected runtime dependency");
  if (!release.publicationEnabled && pkg.private !== true)
    throw new Error("Disabled release requires npm private:true");
  if (
    publication &&
    (!release.publicationEnabled ||
      pkg.private !== false ||
      !paper.authorsFinalized ||
      !/^\d{4}\.\d{4,5}(v\d+)?$/.test(paper.arxivId ?? ""))
  )
    throw new Error(
      "Public release is disabled: finalize author/arXiv metadata and deliberately enable release.json and npm publication",
    );
  for (const name of pkg.files)
    if (!names.has(name)) throw new Error(`Unreviewed npm file: ${name}`);
  for (const [a, b] of [
    [
      "contracts/adapter-fixtures.json",
      "python/tests/fixtures/adapter-fixtures.json",
    ],
    ["contracts/gaze.schema.json", "python/tests/fixtures/gaze.schema.json"],
    [
      "contracts/geometry-fixtures.json",
      "python/tests/fixtures/geometry-fixtures.json",
    ],
    [
      "contracts/diagnostics.json",
      "python/src/gazesync/diagnostics_catalog.json",
    ],
  ])
    if (
      (await readFile(resolve(root, a), "utf8")) !==
      (await readFile(resolve(root, b), "utf8"))
    )
      throw new Error(`Shared contract differs: ${b}`);
  for (const name of ["CITATION.cff", "CITATION.bib", "NOTICE"]) {
    if (
      (await readFile(resolve(root, name), "utf8")) !==
      (await readFile(resolve(root, "python/src/gazesync", name), "utf8"))
    )
      throw new Error(`Packaged attribution differs: ${name}`);
  }
  let bytes = 0;
  for (const name of names) {
    const data = await readFile(await reviewedFile(root, name));
    bytes += data.byteLength;
    if (!/\.(?:[cm]?js|ts)$/.test(name) || name.startsWith("dist/")) continue;
    for (const match of data
      .toString("utf8")
      .matchAll(
        /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(['"])([^'"\n]+)\1/g,
      )) {
      const specifier = match[2];
      if (specifier.startsWith("node:") && !/^(src|demo|examples)\//.test(name))
        continue;
      if (specifier === pkg.name || specifier.startsWith(pkg.name + "/"))
        continue;
      if (!specifier.startsWith("."))
        throw new Error(`External import in ${name}: ${specifier}`);
      let target = relative(root, resolve(root, dirname(name), specifier))
        .split(sep)
        .join("/");
      if (name.endsWith(".ts") && target.startsWith("src/"))
        target = target.replace(/\.js$/, ".ts");
      if (!names.has(target))
        throw new Error(
          `Import escapes reviewed files in ${name}: ${specifier}`,
        );
    }
  }
  return {
    package: pkg.name,
    version: pkg.version,
    reviewedFiles: names.size,
    bytes,
    runtimeDependencies: 0,
    publicationEnabled: release.publicationEnabled,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  console.log(
    JSON.stringify(
      await checkRelease(
        resolve(dirname(fileURLToPath(import.meta.url)), ".."),
        { publication: process.argv.includes("--public") },
      ),
      null,
      2,
    ),
  );
