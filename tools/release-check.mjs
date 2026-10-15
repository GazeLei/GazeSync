import { readFile } from 'node:fs/promises'
import { dirname, resolve, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { publicManifest, reviewedFile } from './files.mjs'
import { IMPLEMENTATION_VERSION } from '../src/version.js'

export async function checkRelease(root) {
  const manifest = await publicManifest(root),
    names = new Set(manifest.repositoryFiles)
  const pkg = JSON.parse(
    await readFile(await reviewedFile(root, 'package.json'), 'utf8'),
  )
  if (pkg.version !== IMPLEMENTATION_VERSION)
    throw new Error('Package and recording implementation versions differ')
  if (pkg.private !== true || pkg.license !== 'UNLICENSED')
    throw new Error(
      'Publication must remain disabled until the license decision is completed',
    )
  if (Object.keys(pkg.dependencies ?? {}).length)
    throw new Error('Unexpected runtime dependency')
  for (const name of pkg.files)
    if (!names.has(name))
      throw new Error(`Package file is not reviewed: ${name}`)
  let bytes = 0
  for (const name of names) {
    const data = await readFile(await reviewedFile(root, name))
    bytes += data.byteLength
    if (!/\.(?:[cm]?js|ts)$/.test(name)) continue
    const source = data.toString('utf8')
    for (const match of source.matchAll(
      /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(['"])([^'"\n]+)\1/g,
    )) {
      const specifier = match[2]
      if (specifier.startsWith('node:') && !/^(src|demo|examples)\//.test(name))
        continue
      if (specifier === pkg.name || specifier.startsWith(pkg.name + '/'))
        continue
      if (!specifier.startsWith('.'))
        throw new Error(`External import in ${name}: ${specifier}`)
      const target = relative(root, resolve(root, dirname(name), specifier))
        .split(sep)
        .join('/')
      if (!names.has(target))
        throw new Error(
          `Import escapes the reviewed package in ${name}: ${specifier}`,
        )
    }
  }
  return {
    package: pkg.name,
    version: pkg.version,
    reviewedFiles: names.size,
    bytes,
    runtimeDependencies: 0,
    publicationEnabled: false,
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  console.log(
    JSON.stringify(
      await checkRelease(
        resolve(dirname(fileURLToPath(import.meta.url)), '..'),
      ),
      null,
      2,
    ),
  )
}
