import {
  clamp,
  constrain,
  createView,
  finite,
  panBy,
  point,
  positive,
  resetView,
  resizeView,
  zoomAt,
  zoomLevel,
  zoomToBox,
} from './geometry.js'

const middle = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

/** Platform-neutral gesture state machine. No gaze is used as a gesture or hidden control. */
export class ZoomController {
  constructor(
    view,
    {
      onInput = () => {},
      dragThreshold = 5,
      doubleTapMs = 320,
      doubleTapDistance = 24,
      inputPrefix = 'input',
    } = {},
  ) {
    positive(dragThreshold, 'dragThreshold')
    positive(doubleTapMs, 'doubleTapMs')
    positive(doubleTapDistance, 'doubleTapDistance')
    if (typeof inputPrefix !== 'string' || !inputPrefix)
      throw new TypeError('inputPrefix must be a nonempty string')
    createView(view)
    positive(view.scale, 'view.scale')
    finite(view.tx, 'view.tx')
    finite(view.ty, 'view.ty')
    this.view = constrain({ ...view })
    this.onInput = onInput
    this.dragThreshold = dragThreshold
    this.doubleTapMs = doubleTapMs
    this.doubleTapDistance = doubleTapDistance
    this.mode = 'pan'
    this.pointers = new Map()
    this.selection = null
    this.gesture = null
    this.lastTap = null
    this.sequence = 0
    this.inputPrefix = inputPrefix
  }

  emit(kind, t, details = {}) {
    finite(t, 'input time')
    const event = {
      ...details,
      id: `${this.inputPrefix}-${++this.sequence}`,
      t,
      kind,
    }
    this.onInput(structuredClone(event))
    return event
  }

  setMode(mode) {
    if (!['pan', 'box'].includes(mode))
      throw new TypeError('Mode must be pan or box')
    this.mode = mode
  }

  wheel({ x, y, deltaY, deltaMode = 0, t }) {
    point({ x, y })
    finite(deltaY, 'deltaY')
    finite(t, 'input time')
    if (![0, 1, 2].includes(deltaMode))
      throw new RangeError('Unknown wheel deltaMode')
    if (this.pointers.size) this.cancel(t, 'wheel-interrupt')
    const pixels =
      deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? this.view.height : 1)
    this.view = zoomAt(this.view, Math.exp(clamp(-pixels * 0.002, -4, 4)), {
      x,
      y,
    })
    this.emit('wheel', t, { x, y, deltaY, deltaMode })
  }

  zoom(
    factor,
    t,
    anchor = { x: this.view.width / 2, y: this.view.height / 2 },
  ) {
    finite(t, 'input time')
    const next = zoomAt(this.view, factor, anchor)
    if (this.pointers.size) this.cancel(t, 'zoom-interrupt')
    this.view = next
    this.emit('zoom', t, { factor, anchor })
  }

  reset(t) {
    this.cancel(t, 'reset')
    this.view = resetView(this.view)
    this.emit('reset', t)
  }

  resize(width, height, t) {
    const next = resizeView(this.view, width, height)
    this.cancel(t, 'layout-change')
    this.view = next
    this.emit('resize', t, { width, height })
  }

  rebase() {
    const pointers = [...this.pointers.values()]
    this.selection = null
    if (pointers.length === 2) {
      pointers.forEach((p) => {
        p.pinched = true
      })
      this.gesture = {
        type: 'pinch',
        base: { ...this.view },
        start: middle(...pointers),
        distance: Math.max(distance(...pointers), 1),
      }
    } else if (pointers.length === 1) {
      const p = pointers[0]
      this.gesture = {
        type:
          p.type === 'mouse' &&
          (this.mode === 'box' || p.shiftKey) &&
          p.button !== 1
            ? 'box'
            : 'pan',
        base: { ...this.view },
        start: { x: p.x, y: p.y },
      }
    } else this.gesture = null
  }

  pointerDown({
    id,
    x,
    y,
    t,
    pointerType = 'mouse',
    shiftKey = false,
    button = 0,
  }) {
    point({ x, y })
    finite(t, 'input time')
    if (
      this.pointers.has(id) ||
      this.pointers.size >= 2 ||
      (pointerType === 'mouse' && ![0, 1].includes(button))
    )
      return false
    if (id === undefined) throw new TypeError('Pointer id is required')
    this.pointers.set(id, {
      id,
      x,
      y,
      type: pointerType,
      shiftKey,
      button,
      down: { x, y },
      downTime: t,
      moved: false,
      pinched: false,
    })
    this.rebase()
    this.emit('pointer', t, { phase: 'down', pointerId: id, x, y, pointerType })
    return true
  }

  pointerMove({ id, x, y, t }) {
    point({ x, y })
    finite(t, 'input time')
    const p = this.pointers.get(id)
    if (!p) return false
    p.x = x
    p.y = y
    if (distance(p.down, p) >= this.dragThreshold) p.moved = true
    const g = this.gesture
    const pointers = [...this.pointers.values()]
    if (g.type === 'pinch') {
      this.view = zoomAt(
        g.base,
        Math.max(distance(...pointers), 1) / g.distance,
        g.start,
        middle(...pointers),
      )
    } else if (p.moved || p.pinched) {
      if (g.type === 'box')
        this.selection = { start: { ...g.start }, end: { x, y } }
      else this.view = panBy(g.base, x - g.start.x, y - g.start.y)
    }
    this.emit('pointer', t, {
      phase: 'move',
      pointerId: id,
      x,
      y,
      gesture: g.type,
    })
    return true
  }

  pointerUp({ id, x, y, t }) {
    if (!this.pointers.has(id)) return false
    // A platform may deliver the final position only in pointerup.
    this.pointerMove({ id, x, y, t })
    const p = this.pointers.get(id)
    if (this.gesture.type === 'box' && this.selection) {
      this.view = zoomToBox(this.view, this.selection.start, this.selection.end)
      this.emit('box-zoom', t, this.selection)
    }
    const tap =
      p.type === 'touch' &&
      !p.moved &&
      !p.pinched &&
      t - p.downTime <= this.doubleTapMs
    this.pointers.delete(id)
    this.rebase() // Pinch -> one-finger pan starts from the current view, without a jump.
    if (tap) {
      if (
        this.lastTap &&
        t - this.lastTap.t >= 0 &&
        t - this.lastTap.t <= this.doubleTapMs &&
        distance(p, this.lastTap) <= this.doubleTapDistance
      ) {
        this.doubleTap({ x, y, t })
        this.lastTap = null
      } else this.lastTap = { x, y, t }
    } else this.lastTap = null
    this.emit('pointer', t, { phase: 'up', pointerId: id, x, y })
    return true
  }

  doubleTap({ x, y, t }) {
    point({ x, y })
    finite(t, 'input time')
    if (this.pointers.size) this.cancel(t, 'double-tap-interrupt')
    this.view =
      zoomLevel(this.view) > 1.01
        ? resetView(this.view)
        : zoomAt(this.view, 2.5, { x, y })
    this.emit('double-tap', t, { x, y })
  }

  cancel(t, reason = 'cancel') {
    finite(t, 'input time')
    const active = this.pointers.size > 0
    this.pointers.clear()
    this.gesture = null
    this.selection = null
    this.lastTap = null
    if (active || reason !== 'cancel') this.emit('cancel', t, { reason })
  }

  key({ key, t, ctrlKey = false, metaKey = false }) {
    finite(t, 'input time')
    if ((key === '0' && (ctrlKey || metaKey)) || key === 'Home') this.reset(t)
    else if (key === 'Escape') {
      if (this.pointers.size) this.cancel(t, 'escape')
      else this.reset(t)
    } else if (key === '+' || key === '=') this.zoom(1.25, t)
    else if (key === '-') this.zoom(0.8, t)
    else if (
      ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)
    ) {
      if (this.pointers.size) this.cancel(t, 'key-interrupt')
      this.view = panBy(
        this.view,
        key === 'ArrowLeft' ? 48 : key === 'ArrowRight' ? -48 : 0,
        key === 'ArrowUp' ? 48 : key === 'ArrowDown' ? -48 : 0,
      )
      this.emit('key-pan', t, { key })
    } else return false
    return true
  }
}
