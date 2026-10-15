import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";

export function checkedRelative(name) {
  if (
    typeof name !== "string" ||
    !name ||
    isAbsolute(name) ||
    name.includes("\\") ||
    name.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Invalid public file path");
  return name;
}

export async function reviewedFile(root, name) {
  checkedRelative(name);
  const canonicalRoot = await realpath(root),
    file = resolve(canonicalRoot, name);
  const info = await lstat(file),
    canonicalFile = await realpath(file);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    canonicalFile !== file ||
    !canonicalFile.startsWith(canonicalRoot + sep)
  ) {
    throw new Error(`Public file is not a regular contained file: ${name}`);
  }
  return file;
}

export async function publicManifest(root) {
  const manifest = JSON.parse(
    await readFile(await reviewedFile(root, "public-files.json"), "utf8"),
  );
  if (manifest.schemaVersion !== 1)
    throw new Error("Unknown public-files manifest");
  manifest.generatedFiles ??= [];
  for (const key of ["repositoryFiles", "webFiles", "generatedFiles"]) {
    if (
      !Array.isArray(manifest[key]) ||
      new Set(manifest[key]).size !== manifest[key].length
    )
      throw new Error(`Invalid ${key}`);
    manifest[key].forEach(checkedRelative);
  }
  if (
    manifest.webFiles.some(
      (name) =>
        !manifest.repositoryFiles.includes(name) &&
        !manifest.generatedFiles.includes(name),
    )
  )
    throw new Error("Web file is outside repository allowlist");
  return manifest;
}
