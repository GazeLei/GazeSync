/** Browser-only adapter. Importing the core does not require a DOM. */
export function attachBrowserControls(
  element,
  controller,
  { onChange = () => {}, onLifecycle = () => {} } = {},
) {
  const document = element.ownerDocument ?? globalThis.document
  const window = document.defaultView ?? globalThis.window
  const now = () => (window.performance ?? globalThis.performance).now()
  const interactive = (event) => {
    for (const target of event.composedPath?.() ?? [event.target]) {
      if (target === element) break
      if (
        target?.matches?.(
          'input,textarea,select,button,a[href],[contenteditable]:not([contenteditable="false"])',
        )
      )
        return true
    }
    return false
  }
  const disposers = []
  const previous = {
    touchAction: element.style.touchAction,
    tabIndex: element.getAttribute('tabindex'),
  }
  element.style.touchAction = 'none'
  if (!element.hasAttribute('tabindex')) element.tabIndex = 0
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options)
    disposers.push(() => target.removeEventListener(type, handler, options))
  }
  const time = (e) => {
    const current = now()
    return Number.isFinite(e.timeStamp) &&
      Math.abs(e.timeStamp - current) < 60000
      ? e.timeStamp
      : current
  }
  const local = (e) => {
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return {
      x: ((e.clientX - rect.left) * controller.view.width) / rect.width,
      y: ((e.clientY - rect.top) * controller.view.height) / rect.height,
    }
  }
  const captured = new Set()
  const release = () => {
    for (const id of captured)
      if (element.hasPointerCapture(id)) element.releasePointerCapture(id)
    captured.clear()
  }
  listen(
    element,
    'wheel',
    (e) => {
      if (interactive(e)) return
      const p = local(e)
      if (!p) return
      e.preventDefault()
      controller.wheel({
        ...p,
        deltaY: e.deltaY,
        deltaMode: e.deltaMode,
        t: time(e),
      })
      if (!controller.pointers.size) release()
      onChange()
    },
    { passive: false },
  )
  listen(element, 'pointerdown', (e) => {
    if (interactive(e)) return
    const p = local(e)
    if (!p) return
    if (
      controller.pointerDown({
        ...p,
        id: e.pointerId,
        t: time(e),
        pointerType: e.pointerType,
        shiftKey: e.shiftKey,
        button: e.button,
      })
    ) {
      e.preventDefault()
      element.focus({ preventScroll: true })
      element.setPointerCapture(e.pointerId)
      captured.add(e.pointerId)
      onChange()
    }
  })
  listen(element, 'pointermove', (e) => {
    const p = local(e)
    if (p && controller.pointerMove({ ...p, id: e.pointerId, t: time(e) }))
      onChange()
  })
  listen(element, 'pointerup', (e) => {
    const p = local(e)
    if (p && controller.pointerUp({ ...p, id: e.pointerId, t: time(e) }))
      onChange()
    captured.delete(e.pointerId)
    if (element.hasPointerCapture(e.pointerId))
      element.releasePointerCapture(e.pointerId)
  })
  const cancel = (reason) => {
    controller.cancel(now(), reason)
    release()
    onLifecycle(reason)
    onChange()
  }
  listen(element, 'pointercancel', (e) => {
    if (controller.pointers.has(e.pointerId)) cancel('pointer-cancel')
  })
  listen(element, 'lostpointercapture', (e) => {
    if (controller.pointers.has(e.pointerId)) cancel('capture-lost')
  })
  listen(element, 'keydown', (e) => {
    if (interactive(e) || e.altKey) return
    if (
      controller.key({
        key: e.key,
        t: time(e),
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
      })
    ) {
      e.preventDefault()
      if (!controller.pointers.size) release()
      onChange()
    }
  })
  listen(window, 'blur', () => cancel('blur'))
  listen(document, 'visibilitychange', () => {
    if (document.hidden) cancel('background')
    else {
      onLifecycle('foreground')
      onChange()
    }
  })
  let disposed = false
  return {
    dispose() {
      if (disposed) return
      disposed = true
      disposers.forEach((dispose) => dispose())
      controller.cancel(now(), 'dispose')
      release()
      element.style.touchAction = previous.touchAction
      if (previous.tabIndex === null) element.removeAttribute('tabindex')
      else element.setAttribute('tabindex', previous.tabIndex)
    },
  }
}
