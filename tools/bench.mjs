import { performance } from 'node:perf_hooks'
import { createView, GazeSession } from '../src/index.js'

const samples = 20000,
  session = new GazeSession({ maxFrames: 256, maxRecords: 4096 })
const view = createView({
  width: 1000,
  height: 600,
  contentWidth: 2000,
  contentHeight: 1200,
})
const batches = [],
  start = performance.now()
let delivered = 0
for (let i = 0; i < samples; i += 2) {
  const begin = performance.now(),
    t = (i * 1000) / 120
  session.present({ t, view, surface: { id: 'display', epoch: '1' } })
  for (let j = 0; j < 2; j++)
    session.gaze(
      {
        id: String(i + j),
        sourceId: 'sensor',
        clockId: 'session',
        clockEpoch: '0',
        timeMs: t + (j * 1000) / 120,
        surfaceId: 'display',
        surfaceEpoch: '1',
        type: 'pog2d',
        space: 'normalized-viewport',
        point: { x: 0.5, y: 0.5 },
        valid: true,
        confidence: 1,
      },
      t + 12,
    )
  delivered += session.flush(t).length
  batches.push(performance.now() - begin)
}
delivered += session.flush((samples * 1000) / 120 + 100, { final: true }).length
const elapsedMs = performance.now() - start
batches.sort((a, b) => a - b)
console.log(
  JSON.stringify(
    {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      samples,
      delivered,
      elapsedMs,
      throughputSamplesPerSecond: (samples / elapsedMs) * 1000,
      p95TwoSampleBatchMs: batches[Math.floor(batches.length * 0.95)],
      recordsRetained: session.records.length,
      recordsDropped: session.recordsDropped,
      heapUsedBytes: process.memoryUsage().heapUsed,
      scope:
        'In-process synthetic microbenchmark with retention rollover; excludes rendering, camera, networking and storage. Not a real-time device guarantee.',
    },
    null,
    2,
  ),
)
if (delivered !== samples) process.exitCode = 1
