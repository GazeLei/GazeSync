/** Logical viewport pixels (CSS px / native points); content units are intrinsic pixels. */
export function finite(value, name) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`)
  return value
}

export function positive(value, name) {
  if (finite(value, name) <= 0) throw new RangeError(`${name} must be positive`)
  return value
}

export function point(value, name = 'point') {
  finite(value?.x, `${name}.x`)
  finite(value?.y, `${name}.y`)
  return value
}

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
export const fitScale = (v) =>
  Math.min(v.width / v.contentWidth, v.height / v.contentHeight)
export const zoomLevel = (v) => v.scale / fitScale(v)
export const viewMatrix = (v) => [v.scale, 0, 0, v.scale, v.tx, v.ty]

export function validateMatrix(m) {
  if (!Array.isArray(m) || m.length !== 6)
    throw new TypeError('Affine matrix needs six numbers')
  m.forEach((n) => finite(n, 'matrix coefficient'))
  const magnitude = Math.max(...m.slice(0, 4).map(Math.abs))
  const determinant =
    (m[0] / magnitude) * (m[3] / magnitude) -
    (m[1] / magnitude) * (m[2] / magnitude)
  if (
    !Number.isFinite(determinant) ||
    Math.abs(determinant) <= 32 * Number.EPSILON
  )
    throw new RangeError('Singular or ill-conditioned affine matrix')
  return m
}

export function applyAffine(m, p) {
  const result = {
    x: m[0] * p.x + m[2] * p.y + m[4],
    y: m[1] * p.x + m[3] * p.y + m[5],
  }
  point(result, 'affine output')
  return result
}

export function invertAffine(m) {
  validateMatrix(m)
  const magnitude = Math.max(...m.slice(0, 4).map(Math.abs))
  const [a, b, c, d] = m.slice(0, 4).map((n) => n / magnitude)
  const det = a * d - b * c
  const inverse = [
    d / det / magnitude,
    -b / det / magnitude,
    -c / det / magnitude,
    a / det / magnitude,
  ]
  inverse.push(
    -inverse[0] * m[4] - inverse[2] * m[5],
    -inverse[1] * m[4] - inverse[3] * m[5],
  )
  inverse.forEach((n) => finite(n, 'inverse affine coefficient'))
  return inverse
}

export function constrain(v) {
  const scale = clamp(v.scale, fitScale(v) * v.minZoom, fitScale(v) * v.maxZoom)
  const w = v.contentWidth * scale
  const h = v.contentHeight * scale
  positive(scale, 'view scale')
  positive(w, 'rendered width')
  positive(h, 'rendered height')
  finite(v.tx, 'view tx')
  finite(v.ty, 'view ty')
  return {
    ...v,
    scale,
    tx: w <= v.width ? (v.width - w) / 2 : clamp(v.tx, v.width - w, 0),
    ty: h <= v.height ? (v.height - h) / 2 : clamp(v.ty, v.height - h, 0),
  }
}

export function createView({
  width,
  height,
  contentWidth,
  contentHeight,
  minZoom = 1,
  maxZoom = 16,
}) {
  Object.entries({
    width,
    height,
    contentWidth,
    contentHeight,
    minZoom,
    maxZoom,
  }).forEach(([k, n]) => positive(n, k))
  if (minZoom > 1 || maxZoom < 1)
    throw new RangeError('Zoom limits must include original fit (1)')
  const v = { width, height, contentWidth, contentHeight, minZoom, maxZoom }
  return constrain({ ...v, scale: fitScale(v), tx: 0, ty: 0 })
}

export function resetView(v) {
  return constrain({ ...v, scale: fitScale(v), tx: 0, ty: 0 })
}

export function contentToViewport(v, p) {
  return applyAffine(viewMatrix(v), point(p))
}

export function viewportToContent(v, p) {
  point(p)
  return { x: (p.x - v.tx) / v.scale, y: (p.y - v.ty) / v.scale }
}

/** Keep the content under `anchor` under `destination`; boundaries can limit this. */
export function zoomAt(v, factor, anchor, destination = anchor) {
  positive(factor, 'zoom factor')
  point(destination)
  const p = viewportToContent(v, anchor)
  const scale = clamp(
    v.scale * factor,
    fitScale(v) * v.minZoom,
    fitScale(v) * v.maxZoom,
  )
  return constrain({
    ...v,
    scale,
    tx: destination.x - p.x * scale,
    ty: destination.y - p.y * scale,
  })
}

export function panBy(v, dx, dy) {
  finite(dx, 'dx')
  finite(dy, 'dy')
  return constrain({ ...v, tx: v.tx + dx, ty: v.ty + dy })
}

export function zoomToBox(v, start, end, minimumSize = 6) {
  point(start)
  point(end)
  positive(minimumSize, 'minimum box size')
  const x0 = clamp(Math.min(start.x, end.x), 0, v.width)
  const y0 = clamp(Math.min(start.y, end.y), 0, v.height)
  const x1 = clamp(Math.max(start.x, end.x), 0, v.width)
  const y1 = clamp(Math.max(start.y, end.y), 0, v.height)
  if (x1 - x0 < minimumSize || y1 - y0 < minimumSize) return { ...v }
  return zoomAt(
    v,
    Math.min(v.width / (x1 - x0), v.height / (y1 - y0)),
    { x: (x0 + x1) / 2, y: (y0 + y1) / 2 },
    { x: v.width / 2, y: v.height / 2 },
  )
}

/** Resizing retains zoom relative to fit and the content at the old viewport center. */
export function resizeView(v, width, height) {
  positive(width, 'width')
  positive(height, 'height')
  const center = viewportToContent(v, { x: v.width / 2, y: v.height / 2 })
  const result = { ...v, width, height }
  const scale = fitScale(result) * zoomLevel(v)
  return constrain({
    ...result,
    scale,
    tx: width / 2 - center.x * scale,
    ty: height / 2 - center.y * scale,
  })
}

export const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0)
export const sub = (a, b) => a.map((n, i) => n - b[i])
export const add = (a, b) => a.map((n, i) => n + b[i])
export const multiply = (a, s) => a.map((n) => n * s)
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

export function vector(v, name) {
  if (!Array.isArray(v) || v.length !== 3)
    throw new TypeError(`${name} needs three numbers`)
  v.forEach((n) => finite(n, name))
  return v
}

export function validatePlane(p) {
  if (typeof p?.frameId !== 'string' || !p.frameId)
    throw new TypeError('Plane needs an explicit coordinate frameId')
  vector(p.topLeft, 'plane.topLeft')
  vector(p.right, 'plane.right')
  vector(p.down, 'plane.down')
  positive(p.widthMeters, 'plane.widthMeters')
  positive(p.heightMeters, 'plane.heightMeters')
  if (p.static !== undefined && typeof p.static !== 'boolean')
    throw new TypeError('plane.static must be boolean')
  if (
    Math.abs(dot(p.right, p.right) - 1) > 1e-6 ||
    Math.abs(dot(p.down, p.down) - 1) > 1e-6 ||
    Math.abs(dot(p.right, p.down)) > 1e-6
  )
    throw new RangeError('Plane axes must be orthonormal unit vectors')
  return p
}

/** A ray/plane crossing is a display crossing, never an inferred world fixation/depth. */
export function projectRay(ray, plane, width, height) {
  if (!plane) return { reason: 'missing-plane' }
  validatePlane(plane)
  positive(width, 'viewport width')
  positive(height, 'viewport height')
  vector(ray.origin, 'ray.origin')
  vector(ray.direction, 'ray.direction')
  if (ray.frameId !== plane.frameId)
    return { reason: 'coordinate-frame-mismatch' }
  const magnitude = Math.max(...ray.direction.map(Math.abs))
  if (magnitude === 0) return { reason: 'zero-ray' }
  const scaled = ray.direction.map((n) => n / magnitude)
  const direction = multiply(scaled, 1 / Math.hypot(...scaled))
  const normal = cross(plane.right, plane.down)
  const denominator = dot(direction, normal)
  if (Math.abs(denominator) < 1e-9) return { reason: 'parallel-ray' }
  const distanceMeters =
    dot(sub(plane.topLeft, ray.origin), normal) / denominator
  if (!Number.isFinite(distanceMeters))
    return { reason: 'non-finite-projection' }
  if (distanceMeters <= 0) return { reason: 'ray-behind-plane' }
  const hit = add(ray.origin, multiply(direction, distanceMeters))
  const offset = sub(hit, plane.topLeft)
  const result = {
    point: {
      x: (dot(offset, plane.right) / plane.widthMeters) * width,
      y: (dot(offset, plane.down) / plane.heightMeters) * height,
    },
    hit,
    distanceMeters,
  }
  if (![...hit, result.point.x, result.point.y].every(Number.isFinite))
    return { reason: 'non-finite-projection' }
  return result
}
