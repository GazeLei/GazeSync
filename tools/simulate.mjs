import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { isScenarioPassing, runScenario } from '../src/simulation.js'

const args = process.argv.slice(2)
const outIndex = args.indexOf('--out')
const out = outIndex === -1 ? null : resolve(args[outIndex + 1] ?? '')
if (outIndex !== -1 && !args[outIndex + 1])
  throw new Error('--out needs a directory (use ignored artifacts/)')
const results = ['desktop', 'mobile'].map((device) => runScenario(device))
if (out) {
  await mkdir(out, { recursive: true })
  for (const result of results)
    await writeFile(
      resolve(out, `${result.summary.device}-session.json`),
      JSON.stringify(result.recording),
    )
  await writeFile(
    resolve(out, 'summary.json'),
    JSON.stringify(
      results.map((r) => r.summary),
      null,
      2,
    ) + '\n',
  )
}
for (const result of results) {
  console.log(JSON.stringify(result.summary, null, 2))
  if (!isScenarioPassing(result.summary)) process.exitCode = 1
}
