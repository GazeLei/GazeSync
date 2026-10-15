import {
  createView,
  contentToViewport,
  viewportToContent,
  GazeSession,
  ZoomController,
  zoomLevel,
} from '../src/index.js'
import { attachBrowserControls } from '../src/browser.js'
import {
  isScenarioPassing,
  rayForPoint,
  runScenario,
  simulatedPlane,
} from '../src/simulation.js'

const $ = (id) => document.getElementById(id)
const scene = $('scene'),
  timeline = $('timeline')
let device = 'desktop',
  mode = 'replay',
  result,
  playback = 0,
  playing = false,
  previousTime = performance.now()
let live,
  controls,
  signal = 'both',
  activeView,
  activeFrame
let telemetryAt = 0
const latestAt = (items, t, key = 't') => {
  let lo = 0,
    hi = items.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (items[mid][key] <= t) lo = mid + 1
    else hi = mid
  }
  return items[lo - 1]
}
const text = (id, value) => {
  if ($(id).textContent !== value) $(id).textContent = value
}

function loadScenario(next) {
  controls?.dispose()
  controls = null
  live = null
  device = next
  mode = 'replay'
  playing = false
  playback = 0
  result = runScenario(device)
  activeFrame = result.scenario.frames[0]
  activeView = activeFrame.view
  for (const id of ['desktop', 'mobile'])
    $(id).setAttribute('aria-pressed', String(id === device))
  $('stage').className = device === 'mobile' ? 'stage mobile' : 'stage'
  $('manual').classList.remove('active')
  text('manual', 'Try it yourself')
  for (const id of ['pan', 'box'])
    $(id).setAttribute('aria-pressed', String(id === 'pan'))
  text(
    'surface-label',
    device === 'mobile' ? 'MERIDIAN / MOBILE' : 'MERIDIAN / VIRTUAL DESKTOP',
  )
  text(
    'help',
    device === 'mobile'
      ? 'Pinch to zoom · One finger to pan · Double-tap to reset'
      : 'Wheel to zoom · Shift-drag a box · Home to reset',
  )
  text('run-label', 'DETERMINISTIC REPLAY')
  text('play', '▶ Play scenario')
  text('ray-origin', 'origin  [ 0.000, 0.008, 0.600 ]')
  text('ray-direction', 'direction  [ —, —, — ]')
  text(
    'event-detail',
    'Select Play scenario to inspect the synchronized sequence.',
  )
  $('scrub').disabled = false
  document.querySelector('.check-badge').textContent = isScenarioPassing(
    result.summary,
  )
    ? 'PASS'
    : 'FAIL'
  text('check-frames', `${result.summary.frameMismatches} mismatches`)
  text(
    'check-pair',
    `${result.summary.paired2D3DMaxDifferencePx.toExponential(1)} px`,
  )
  text('check-replay', result.summary.replayExact ? 'Exact' : 'Mismatch')
  text(
    'check-note',
    `${result.summary.gazeSamples.toLocaleString()} paired-source samples. Known synthetic ground truth.`,
  )
}

function startManual() {
  if (mode === 'manual') return
  mode = 'manual'
  playing = false
  controls?.dispose()
  const session = new GazeSession()
  const now = performance.now()
  const width = device === 'mobile' ? 390 : 1080,
    height = device === 'mobile' ? 700 : 680
  scene.style.aspectRatio = `${width}/${height}`
  const causeIds = []
  const controller = new ZoomController(
    createView({ width, height, contentWidth: 1600, contentHeight: 1100 }),
    {
      onInput: (e) => {
        session.input(e)
        causeIds.push(e.id)
      },
    },
  )
  live = {
    session,
    controller,
    causeIds,
    start: now,
    lastSample: now,
    deliveries: [],
    sampleIndex: 0,
    surface: {
      id: device,
      epoch: 'manual-1',
      active: true,
      plane: simulatedPlane(device),
    },
    target: { x: 940, y: 500 },
    targetStep: -1,
    records: [],
  }
  session.present({
    t: now,
    contentId: 'synthetic-meridian-v1',
    view: controller.view,
    surface: live.surface,
    timing: 'synthetic',
  })
  controls = attachBrowserControls(scene, controller, {
    onLifecycle: (reason) => {
      if (reason === 'background') live.surface.active = false
      if (reason === 'foreground') {
        live.surface.active = true
        live.lastSample = performance.now()
        live.deliveries = []
      }
    },
  })
  $('stage').className = device === 'mobile' ? 'stage mobile' : 'stage'
  text('manual', 'Hands-on mode')
  $('manual').classList.add('active')
  text('run-label', 'MANUAL INPUT / SIMULATED GAZE')
  text('play', '▶ Replay scenario')
  $('scrub').disabled = true
  document.querySelector('.check-badge').textContent = 'LIVE'
  text('check-frames', 'Recording')
  text('check-pair', 'Paired signals')
  text('check-replay', 'Export to inspect')
  text(
    'check-note',
    'Real input gestures with a synthetic eye signal. Pointer location is independent of gaze.',
  )
  scene.focus({ preventScroll: true })
}

function updateLive(now) {
  const { session, controller, surface } = live
  // Process sensor exposure times against the history already rendered; do not
  // backdate the new input view into the gap between requestAnimationFrame calls.
  const step = Math.floor((now - live.start) / 1600)
  if (step !== live.targetStep) {
    live.targetStep = step
    live.target = viewportToContent(controller.view, {
      x: controller.view.width * (0.3 + (step % 3) * 0.2),
      y: controller.view.height * (0.38 + (step % 2) * 0.16),
    })
  }
  // Background suspension is a sample gap. Bound catch-up after a slow tab/device.
  if (now - live.lastSample > 250) live.lastSample = now - 16
  while (surface.active && live.lastSample + 1000 / 120 < now) {
    live.lastSample += 1000 / 120
    const t = live.lastSample
    const f = session.frameAt(t)
    if (!f) continue
    const p = contentToViewport(f.view, live.target)
    p.x += Math.sin(t * 0.72) * 0.45
    p.y += Math.cos(t * 0.53) * 0.45
    const blink = (t - live.start) % 3000 > 2760
    const i = ++live.sampleIndex
    for (const type of ['pog2d', 'ray3d']) {
      const sample = {
        id: `${type}-${i}`,
        sourceId: `demo-${type}`,
        clockId: 'session',
        clockEpoch: '0',
        timeMs: t,
        surfaceId: device,
        surfaceEpoch: surface.epoch,
        valid: !blink,
        blink,
        confidence: 0.99,
        type,
        ...(type === 'pog2d'
          ? {
              space: 'normalized-viewport',
              point: { x: p.x / f.view.width, y: p.y / f.view.height },
            }
          : { ray: rayForPoint(p, f.view, f.surface.plane, t) }),
      }
      live.deliveries.push({ t: t + 28 + (i % 17) * 2, sample })
    }
  }
  activeView = controller.view
  activeFrame = {
    view: activeView,
    surface,
    selection: controller.selection,
    pointers: [...controller.pointers.values()],
  }
  drawScene(activeFrame, [], now)
  const presented = performance.now()
  session.present({
    t: presented,
    contentId: 'synthetic-meridian-v1',
    view: activeView,
    surface,
    causeIds: live.causeIds.splice(0),
    timing: 'render-callback',
  })
  const due = live.deliveries
    .filter((item) => item.t <= presented)
    .sort((a, b) => a.t - b.t)
  live.deliveries = live.deliveries.filter((item) => item.t > presented)
  for (const item of due) session.gaze(item.sample, presented)
  live.records.push(...session.flush(presented))
  if (live.records.length > 4000)
    live.records.splice(0, live.records.length - 4000)
  return live.records
}

function fitCanvas(canvas, width, height) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const pxWidth = Math.round(width * dpr),
    pxHeight = Math.round(height * dpr)
  if (canvas.width !== pxWidth || canvas.height !== pxHeight) {
    canvas.width = pxWidth
    canvas.height = pxHeight
  }
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return ctx
}

function rounded(ctx, x, y, w, h, radius, fill) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, radius)
  ctx.fillStyle = fill
  ctx.fill()
}

function drawMap(ctx) {
  ctx.fillStyle = '#e7ebdd'
  ctx.fillRect(0, 0, 1600, 1100)
  ctx.fillStyle = '#c2d4c0'
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(600, 0)
  ctx.bezierCurveTo(510, 160, 340, 90, 280, 280)
  ctx.bezierCurveTo(230, 450, 80, 440, 0, 520)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#a1bcc2'
  ctx.beginPath()
  ctx.moveTo(1600, 380)
  ctx.bezierCurveTo(1250, 330, 1450, 750, 1050, 830)
  ctx.bezierCurveTo(880, 900, 780, 900, 680, 1100)
  ctx.lineTo(1600, 1100)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = '#f7f7ed'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (let i = 0; i < 8; i++) {
    ctx.lineWidth = i === 4 ? 25 : 13
    ctx.beginPath()
    ctx.moveTo(130 + i * 180, -100)
    ctx.lineTo(-50 + i * 180, 1140)
    ctx.stroke()
  }
  for (let i = 0; i < 7; i++) {
    ctx.lineWidth = i === 3 ? 25 : 13
    ctx.beginPath()
    ctx.moveTo(-20, 80 + i * 155)
    ctx.lineTo(1650, 250 + i * 155)
    ctx.stroke()
  }
  const blocks = [
    [360, 180, 110, 75],
    [525, 200, 100, 90],
    [700, 230, 110, 85],
    [875, 235, 110, 100],
    [1010, 285, 100, 95],
    [310, 355, 120, 90],
    [480, 380, 120, 88],
    [650, 390, 120, 100],
    [830, 420, 100, 90],
    [1030, 450, 110, 90],
    [290, 540, 95, 80],
    [440, 550, 120, 90],
    [620, 580, 120, 80],
    [800, 590, 105, 90],
    [980, 620, 90, 90],
    [220, 720, 110, 90],
    [395, 750, 120, 90],
    [570, 740, 110, 95],
    [750, 780, 95, 80],
    [205, 900, 95, 85],
    [380, 915, 95, 80],
  ]
  blocks.forEach(([x, y, w, h], i) =>
    rounded(
      ctx,
      x,
      y,
      w,
      h,
      6,
      ['#d0d8c5', '#d6d9c8', '#cdd8c9', '#dbddcb'][i % 4],
    ),
  )
  rounded(ctx, 775, 90, 350, 125, 55, '#a9c5a3')
  ctx.fillStyle = '#739c71'
  ctx.font = '14px system-ui'
  ctx.fillText('BOTANICAL GARDENS', 850, 155)
  ctx.fillStyle = '#416a71'
  ctx.font = 'italic 27px Georgia'
  ctx.save()
  ctx.translate(1370, 700)
  ctx.rotate(-0.7)
  ctx.fillText('Meridian Bay', 0, 0)
  ctx.restore()
  const sites = [
    [390, 290, '01', 'OBSERVATORY'],
    [920, 360, '02', 'OLD TOWN'],
    [580, 680, '03', 'CENTRAL LIBRARY'],
    [1005, 760, '04', 'WATERFRONT'],
  ]
  sites.forEach(([x, y, n, name]) => {
    ctx.fillStyle = '#254e42'
    ctx.beginPath()
    ctx.arc(x, y, 22, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#f0f6e6'
    ctx.font = '13px system-ui'
    ctx.textAlign = 'center'
    ctx.fillText(n, x, y + 4)
    ctx.fillStyle = '#41644b'
    ctx.font = '600 13px system-ui'
    ctx.fillText(name, x, y + 45)
    ctx.textAlign = 'start'
  })
  rounded(ctx, 44, 44, 233, 112, 8, '#fafbf1ed')
  ctx.fillStyle = '#2d5845'
  ctx.font = '600 26px Georgia'
  ctx.fillText('MERIDIAN', 65, 88)
  ctx.fillStyle = '#8a9a79'
  ctx.font = '11px system-ui'
  ctx.fillText('A FIELD GUIDE TO THE CITY', 66, 115)
  ctx.fillStyle = '#718a6f'
  ctx.font = '10px system-ui'
  ctx.fillText('Explore four places of interest', 66, 138)
  ctx.fillStyle = '#638164'
  ctx.font = '11px system-ui'
  ctx.fillText('N', 1505, 80)
  ctx.strokeStyle = '#638164'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(1510, 97)
  ctx.lineTo(1510, 145)
  ctx.moveTo(1500, 113)
  ctx.lineTo(1510, 97)
  ctx.lineTo(1520, 113)
  ctx.stroke()
}

// Cache only the static scene. Gesture/render history remains in the shared core.
const mapCanvas = document.createElement('canvas')
mapCanvas.width = 1600
mapCanvas.height = 1100
drawMap(mapCanvas.getContext('2d'))

function drawScene(frame, aligned, now) {
  const v = frame.view
  const ctx = fitCanvas(scene, v.width, v.height)
  ctx.fillStyle = '#dce3d9'
  ctx.fillRect(0, 0, v.width, v.height)
  ctx.save()
  ctx.translate(v.tx, v.ty)
  ctx.scale(v.scale, v.scale)
  ctx.drawImage(mapCanvas, 0, 0)
  ctx.restore()
  const byType = new Map()
  const visible = aligned
    .filter((a) => now - a.captureTimeMs < 700 && a.captureTimeMs <= now)
    .sort((a, b) => a.captureTimeMs - b.captureTimeMs)
  for (const a of visible) byType.set(a.type, a)
  for (const type of ['pog2d', 'ray3d']) {
    if (signal !== 'both' && signal !== type) continue
    const newest = byType.get(type)
    if (!newest?.usable || now - newest.captureTimeMs > 180) continue
    const color = type === 'pog2d' ? '#0b8767' : '#ba8530'
    // A historical CONTENT trail is reprojected into this view. Invalid samples split the trace.
    ctx.strokeStyle = color
    ctx.globalAlpha = 0.35
    ctx.lineWidth = 1.5
    ctx.beginPath()
    let connected = false,
      priorSample = null
    for (const a of visible.filter((x) => x.type === type)) {
      if (!a.usable) {
        connected = false
        continue
      }
      if (
        priorSample &&
        (a.captureTimeMs - priorSample.captureTimeMs > 50 ||
          a.surfaceEpoch !== priorSample.surfaceEpoch)
      )
        connected = false
      const p = contentToViewport(v, a.contentPoint)
      if (connected) ctx.lineTo(p.x, p.y)
      else ctx.moveTo(p.x, p.y)
      connected = true
      priorSample = a
    }
    ctx.stroke()
    ctx.globalAlpha = 1
    const p = contentToViewport(v, newest.contentPoint)
    ctx.strokeStyle = color
    ctx.lineWidth = type === 'pog2d' ? 2 : 1.5
    ctx.beginPath()
    ctx.arc(p.x, p.y, type === 'pog2d' ? 13 : 20, 0, Math.PI * 2)
    ctx.stroke()
    if (type === 'pog2d') {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  if (frame.selection) {
    const { start: a, end: b } = frame.selection
    ctx.fillStyle = '#147c6225'
    ctx.strokeStyle = '#147c62'
    ctx.lineWidth = 2
    ctx.setLineDash([6, 4])
    ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y)
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y)
    ctx.setLineDash([])
  }
  for (const p of frame.pointers ?? []) {
    ctx.fillStyle = '#ffffffa0'
    ctx.strokeStyle = '#244f4890'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(p.x, p.y, device === 'mobile' ? 18 : 8, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  if (frame.surface.active === false) {
    ctx.fillStyle = '#203d46b0'
    ctx.fillRect(0, 0, v.width, v.height)
    ctx.fillStyle = '#fff'
    ctx.font = '18px system-ui'
    ctx.textAlign = 'center'
    ctx.fillText('App backgrounded · capture paused', v.width / 2, v.height / 2)
    ctx.textAlign = 'start'
  }
}

function drawTimeline(time, aligned) {
  const w = timeline.clientWidth,
    h = 117,
    ctx = fitCanvas(timeline, w, h)
  ctx.clearRect(0, 0, w, h)
  const left = 10,
    right = w - 16,
    top = 9,
    bottom = 86
  ctx.font = '9px ui-monospace,monospace'
  for (let i = 0; i <= 9; i++) {
    const x = left + ((right - left) * i) / 9
    ctx.strokeStyle = '#edf0e8'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, top)
    ctx.lineTo(x, bottom)
    ctx.stroke()
    ctx.fillStyle = '#a0ac97'
    ctx.fillText(`${i}s`, x - 3, 107)
  }
  const samples = (
    mode === 'replay'
      ? result.recording.aligned
      : aligned.map((a) => ({
          ...a,
          captureTimeMs: a.captureTimeMs - live.start,
        }))
  )
    .slice()
    .sort((a, b) => a.captureTimeMs - b.captureTimeMs)
  const frames =
    mode === 'replay'
      ? result.scenario.frames
      : live.session.frames.map((f) => ({ ...f, t: f.t - live.start }))
  const start = mode === 'manual' ? Math.max(0, time - 9000) : 0
  const xAt = (t) => left + ((right - left) * (t - start)) / 9000
  ctx.strokeStyle = '#325465'
  ctx.lineWidth = 1.7
  ctx.beginPath()
  let first = true
  for (const f of frames) {
    if (f.t < start || f.t > start + 9000) continue
    const x = xAt(f.t),
      y = bottom - Math.min(1, (zoomLevel(f.view) - 1) / 6) * (bottom - top - 4)
    if (first) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
    first = false
  }
  ctx.stroke()
  ctx.strokeStyle = '#1c9773'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  first = true
  let priorGaze = null
  for (const a of samples) {
    if (
      a.type !== 'pog2d' ||
      a.captureTimeMs < start ||
      a.captureTimeMs > start + 9000
    )
      continue
    if (!a.usable) {
      first = true
      continue
    }
    if (
      priorGaze &&
      (a.captureTimeMs - priorGaze.captureTimeMs > 50 ||
        a.surfaceEpoch !== priorGaze.surfaceEpoch)
    )
      first = true
    const f =
      mode === 'replay'
        ? latestAt(result.scenario.frames, a.captureTimeMs)
        : latestAt(live.session.frames, a.captureTimeMs + live.start)
    const y = bottom - (a.viewportPoint.x / f.view.width) * (bottom - top - 3),
      x = xAt(a.captureTimeMs)
    if (first) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
    first = false
    priorGaze = a
  }
  ctx.stroke()
  const inputs =
    mode === 'replay'
      ? result.scenario.inputs
      : live.session.records
          .filter((r) => r.type === 'input')
          .map((r) => ({ ...r.payload, t: r.payload.t - live.start }))
  ctx.strokeStyle = '#c0a56b'
  ctx.lineWidth = 1
  for (const e of inputs) {
    if (
      e.t < start ||
      e.t > start + 9000 ||
      (e.kind === 'pointer' && e.phase === 'move')
    )
      continue
    const x = xAt(e.t)
    ctx.beginPath()
    ctx.moveTo(x, 88)
    ctx.lineTo(x, 94)
    ctx.stroke()
  }
  const head = xAt(time)
  ctx.strokeStyle = '#2a5f4a'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(head, top)
  ctx.lineTo(head, 95)
  ctx.stroke()
  ctx.fillStyle = '#2a5f4a'
  ctx.beginPath()
  ctx.arc(head, top, 3, 0, Math.PI * 2)
  ctx.fill()
}

function updateTelemetry(records, now, view) {
  const a = records
    .filter(
      (record) => record.type === (signal === 'ray3d' ? 'ray3d' : 'pog2d'),
    )
    .reduce(
      (last, next) =>
        !last || next.captureTimeMs > last.captureTimeMs ? next : last,
      null,
    )
  text('metric-zoom', `${zoomLevel(view).toFixed(2)}×`)
  text('zoom-badge', `${zoomLevel(view).toFixed(2)}×`)
  text('metric-delay', a ? `${a.latencyMs.toFixed(1)} ms` : '— ms')
  text(
    'metric-time',
    a
      ? `${(mode === 'manual' ? a.captureTimeMs - live.start : a.captureTimeMs).toFixed(1)} ms`
      : '— ms',
  )
  text(
    'metric-point',
    a?.contentPoint
      ? `${a.contentPoint.x.toFixed(1)}, ${a.contentPoint.y.toFixed(1)}`
      : '—, —',
  )
  const stale = !a || now - a.captureTimeMs > 180
  const good = !stale && a.usable
  text(
    'quality',
    !a && mode === 'replay' && playback < 100
      ? 'Ready to replay'
      : stale
        ? 'Signal gap'
        : good
          ? 'Synchronized'
          : a.flags.includes('blink')
            ? 'Blink · measurement absent'
            : 'Quality gate active',
  )
  $('quality-dot').style.background = good ? '#168361' : '#c39650'
  text(
    'quality-detail',
    !a && mode === 'replay' && playback < 100
      ? '120 Hz eye signal / 60 Hz display'
      : good
        ? 'Capture-time transform matched'
        : 'Samples retained with quality flags',
  )
  const alignedRay =
    a &&
    records.find(
      (record) =>
        record.type === 'ray3d' && record.captureTimeMs === a.captureTimeMs,
    )
  const rawRay = !alignedRay?.usable
    ? null
    : mode === 'replay'
      ? result.scenario.deliveries.find(
          (d) => d.sample.id === alignedRay.sampleId,
        )?.sample
      : live.session.records.findLast(
          (r) =>
            r.type === 'gaze' && r.payload.sample.id === alignedRay.sampleId,
        )?.payload.sample
  const ray = rawRay?.ray
  const format = (values) => values.map((x) => x.toFixed(3)).join(', ')
  if (ray) {
    text('ray-origin', `origin  [ ${format(ray.origin)} ]`)
    const norm = Math.hypot(...ray.direction)
    text(
      'ray-direction',
      `direction  [ ${format(ray.direction.map((n) => n / norm))} ]`,
    )
  } else {
    text('ray-origin', 'origin  [ —, —, — ]')
    text('ray-direction', 'direction  [ —, —, — ]')
  }
}

function animate(now) {
  const dt = Math.min(100, now - previousTime)
  previousTime = now
  let aligned, clock
  if (mode === 'manual') {
    aligned = updateLive(now)
    clock = now
  } else {
    if (playing) playback = Math.min(9000, playback + dt)
    if (playback >= 9000) {
      playing = false
      text('play', '↺ Replay scenario')
    }
    activeFrame =
      latestAt(result.scenario.frames, playback) ?? result.scenario.frames[0]
    activeView = activeFrame.view
    aligned = result.recording.aligned.filter(
      (a) => a.alignedTimeMs <= playback,
    )
    clock = playback
    const landscape =
      device === 'mobile' && activeView.width > activeView.height
    $('stage').className =
      device === 'mobile'
        ? `stage mobile${landscape ? ' landscape' : ''}`
        : 'stage'
    scene.style.aspectRatio = `${activeView.width}/${activeView.height}`
    text(
      'interaction-label',
      latestAt(result.scenario.phases, playback)?.label ??
        'Find a stable landmark',
    )
    $('scrub').value = String(playback)
    text('play-time', `${(playback / 1000).toFixed(2)} / 9.00 s`)
  }
  drawScene(activeFrame, aligned, clock)
  if (now - telemetryAt > 80) {
    telemetryAt = now
    updateTelemetry(aligned, clock, activeView)
    text(
      'stage-caption',
      `${activeView.width} × ${activeView.height} virtual viewport · intrinsic content 1600 × 1100`,
    )
    if (mode === 'manual') {
      text('interaction-label', 'Independent synthetic gaze · try zoom and pan')
      text('play-time', `${((now - live.start) / 1000).toFixed(1)} s`)
    }
    const e =
      mode === 'replay'
        ? latestAt(result.scenario.inputs, playback)
        : live.session.records.filter((r) => r.type === 'input').at(-1)?.payload
    if (e)
      text(
        'event-detail',
        `${mode === 'manual' ? ((e.t - live.start) / 1000).toFixed(2) : (e.t / 1000).toFixed(2)}s / ${e.kind}${e.phase ? ' · ' + e.phase : ''}${e.reason ? ' · ' + e.reason : ''}`,
      )
    drawTimeline(mode === 'manual' ? now - live.start : playback, aligned)
  }
  requestAnimationFrame(animate)
}

for (const id of ['desktop', 'mobile'])
  $(id).addEventListener('click', () => loadScenario(id))
$('play').addEventListener('click', () => {
  if (mode === 'manual') {
    loadScenario(device)
    playing = true
  } else {
    if (playback >= 9000) playback = 0
    playing = !playing
  }
  text('play', playing ? 'Ⅱ Pause replay' : '▶ Play scenario')
})
$('manual').addEventListener('click', startManual)
$('scrub').addEventListener('input', (e) => {
  playing = false
  playback = Number(e.target.value)
  text('play', '▶ Play scenario')
})
$('signal').addEventListener('change', (e) => {
  signal = e.target.value
})
for (const id of ['pan', 'box'])
  $(id).addEventListener('click', () => {
    startManual()
    live.controller.setMode(id)
    for (const other of ['pan', 'box'])
      $(other).setAttribute('aria-pressed', String(id === other))
  })
for (const id of ['plus', 'minus', 'reset'])
  $(id).addEventListener('click', () => {
    startManual()
    const now = performance.now()
    if (id === 'reset') live.controller.reset(now)
    else live.controller.zoom(id === 'plus' ? 1.4 : 1 / 1.4, now)
  })
$('export').addEventListener('click', () => {
  const recording = mode === 'manual' ? live.session.export() : result.recording
  const blob = new Blob([JSON.stringify(recording)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob),
    link = document.createElement('a')
  link.href = url
  link.download = `gaze-tools-${device}-${mode}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
})
window.addEventListener('pagehide', () => controls?.dispose())
loadScenario('desktop')
requestAnimationFrame(animate)
