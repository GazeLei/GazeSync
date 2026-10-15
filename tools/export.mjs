import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { publicManifest, reviewedFile } from './files.mjs'
import { checkRelease } from './release-check.mjs'

const args = process.argv.slice(2)
const option = (key) => {
  const i = args.indexOf(key)
  return i < 0 ? null : args[i + 1]
}
const destination = option('--out')
if (!destination || destination.startsWith('--'))
  throw new Error(
    'Use --out /path/to/new-directory; optional --paper /path/to/report-folder',
  )
const out = resolve(destination),
  root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
try {
  await stat(out)
  throw new Error('Export destination already exists; choose a new directory')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
const summary = await checkRelease(root),
  manifest = await publicManifest(root)
await mkdir(dirname(out), { recursive: true })
const staging = await mkdtemp(resolve(dirname(out), '.gazesync-export-'))
try {
  const inventory = []
  const copy = async (sourceRoot, source, target = source) => {
    const file = await reviewedFile(sourceRoot, source),
      dest = resolve(staging, target)
    await mkdir(dirname(dest), { recursive: true })
    await copyFile(file, dest)
    inventory.push({
      path: target,
      sha256: createHash('sha256')
        .update(await readFile(dest))
        .digest('hex'),
    })
  }
  for (const file of manifest.repositoryFiles) await copy(root, file)
  const paper = option('--paper')
  if (paper)
    for (const file of ['main.tex', 'README.md'])
      await copy(resolve(paper), file, `paper/${file}`)
  await writeFile(
    resolve(staging, 'EXPORT-MANIFEST.json'),
    JSON.stringify({ ...summary, files: inventory }, null, 2) + '\n',
  )
  await rename(staging, out)
  console.log(
    JSON.stringify(
      {
        ...summary,
        output: out,
        exportedFiles: inventory.length,
        paperIncluded: Boolean(paper),
      },
      null,
      2,
    ),
  )
} catch (error) {
  await rm(staging, { recursive: true, force: true })
  throw error
}
