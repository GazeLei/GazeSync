import type {
  Affine,
  RigidTransform,
  Matrix3,
  Plane,
  Point,
  Ray,
  RayProjection,
  Vector3,
  View,
  ViewOptions,
} from "./types.js";
/** Logical viewport pixels (CSS px / native points); content units are intrinsic pixels. */
export function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

export function positive(value: number, name: string): number {
  if (finite(value, name) <= 0)
    throw new RangeError(`${name} must be positive`);
  return value;
}

export function point(value: Point, name = "point"): Point {
  finite(value?.x, `${name}.x`);
  finite(value?.y, `${name}.y`);
  return value;
}

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
export const fitScale = (v: ViewOptions) =>
  Math.min(v.width / v.contentWidth, v.height / v.contentHeight);
export const zoomLevel = (v: View) => v.scale / fitScale(v);
export const viewMatrix = (v: View): Affine => [
  v.scale,
  0,
  0,
  v.scale,
  v.tx,
  v.ty,
];

export function validateMatrix(m: Affine): Affine {
  if (!Array.isArray(m) || m.length !== 6)
    throw new TypeError("Affine matrix needs six numbers");
  m.forEach((n) => finite(n, "matrix coefficient"));
  const magnitude = Math.max(...m.slice(0, 4).map(Math.abs));
  const determinant =
    (m[0] / magnitude) * (m[3] / magnitude) -
    (m[1] / magnitude) * (m[2] / magnitude);
  if (
    !Number.isFinite(determinant) ||
    Math.abs(determinant) <= 32 * Number.EPSILON
  )
    throw new RangeError("Singular or ill-conditioned affine matrix");
  return m;
}

export function applyAffine(m: Affine, p: Point): Point {
  const result = {
    x: m[0] * p.x + m[2] * p.y + m[4],
    y: m[1] * p.x + m[3] * p.y + m[5],
  };
  point(result, "affine output");
  return result;
}

export function invertAffine(m: Affine): Affine {
  validateMatrix(m);
  const magnitude = Math.max(...m.slice(0, 4).map(Math.abs));
  const [a, b, c, d] = m.slice(0, 4).map((n) => n / magnitude);
  const det = a * d - b * c;
  const inverse = [
    d / det / magnitude,
    -b / det / magnitude,
    -c / det / magnitude,
    a / det / magnitude,
  ];
  inverse.push(
    -inverse[0] * m[4] - inverse[2] * m[5],
    -inverse[1] * m[4] - inverse[3] * m[5],
  );
  inverse.forEach((n) => finite(n, "inverse affine coefficient"));
  return inverse as Affine;
}

export function constrain(v: View): View {
  const scale = clamp(
    v.scale,
    fitScale(v) * v.minZoom,
    fitScale(v) * v.maxZoom,
  );
  const w = v.contentWidth * scale;
  const h = v.contentHeight * scale;
  positive(scale, "view scale");
  positive(w, "rendered width");
  positive(h, "rendered height");
  finite(v.tx, "view tx");
  finite(v.ty, "view ty");
  return {
    ...v,
    scale,
    tx: w <= v.width ? (v.width - w) / 2 : clamp(v.tx, v.width - w, 0),
    ty: h <= v.height ? (v.height - h) / 2 : clamp(v.ty, v.height - h, 0),
  };
}

export function createView({
  width,
  height,
  contentWidth,
  contentHeight,
  minZoom = 1,
  maxZoom = 16,
}: ViewOptions): View {
  Object.entries({
    width,
    height,
    contentWidth,
    contentHeight,
    minZoom,
    maxZoom,
  }).forEach(([k, n]) => positive(n, k));
  if (minZoom > 1 || maxZoom < 1)
    throw new RangeError("Zoom limits must include original fit (1)");
  const v = { width, height, contentWidth, contentHeight, minZoom, maxZoom };
  return constrain({ ...v, scale: fitScale(v), tx: 0, ty: 0 });
}

export function resetView(v: View): View {
  return constrain({ ...v, scale: fitScale(v), tx: 0, ty: 0 });
}

export function contentToViewport(v: View, p: Point): Point {
  return applyAffine(viewMatrix(v), point(p));
}

export function viewportToContent(v: View, p: Point): Point {
  point(p);
  return { x: (p.x - v.tx) / v.scale, y: (p.y - v.ty) / v.scale };
}

/** Keep the content under `anchor` under `destination`; boundaries can limit this. */
export function zoomAt(
  v: View,
  factor: number,
  anchor: Point,
  destination: Point = anchor,
): View {
  positive(factor, "zoom factor");
  point(destination);
  const p = viewportToContent(v, anchor);
  const scale = clamp(
    v.scale * factor,
    fitScale(v) * v.minZoom,
    fitScale(v) * v.maxZoom,
  );
  return constrain({
    ...v,
    scale,
    tx: destination.x - p.x * scale,
    ty: destination.y - p.y * scale,
  });
}

export function panBy(v: View, dx: number, dy: number): View {
  finite(dx, "dx");
  finite(dy, "dy");
  return constrain({ ...v, tx: v.tx + dx, ty: v.ty + dy });
}

export function zoomToBox(
  v: View,
  start: Point,
  end: Point,
  minimumSize = 6,
): View {
  point(start);
  point(end);
  positive(minimumSize, "minimum box size");
  const x0 = clamp(Math.min(start.x, end.x), 0, v.width);
  const y0 = clamp(Math.min(start.y, end.y), 0, v.height);
  const x1 = clamp(Math.max(start.x, end.x), 0, v.width);
  const y1 = clamp(Math.max(start.y, end.y), 0, v.height);
  if (x1 - x0 < minimumSize || y1 - y0 < minimumSize) return { ...v };
  return zoomAt(
    v,
    Math.min(v.width / (x1 - x0), v.height / (y1 - y0)),
    { x: (x0 + x1) / 2, y: (y0 + y1) / 2 },
    { x: v.width / 2, y: v.height / 2 },
  );
}

/** Resizing retains zoom relative to fit and the content at the old viewport center. */
export function resizeView(v: View, width: number, height: number): View {
  positive(width, "width");
  positive(height, "height");
  const center = viewportToContent(v, { x: v.width / 2, y: v.height / 2 });
  const result = { ...v, width, height };
  const scale = fitScale(result) * zoomLevel(v);
  return constrain({
    ...result,
    scale,
    tx: width / 2 - center.x * scale,
    ty: height / 2 - center.y * scale,
  });
}

export const dot = (a: Vector3, b: Vector3) =>
  a.reduce((sum, n, i) => sum + n * b[i], 0);
export const sub = (a: Vector3, b: Vector3): Vector3 =>
  a.map((n, i) => n - b[i]) as Vector3;
export const add = (a: Vector3, b: Vector3): Vector3 =>
  a.map((n, i) => n + b[i]) as Vector3;
export const multiply = (a: Vector3, s: number): Vector3 =>
  a.map((n) => n * s) as Vector3;
export const cross = (a: Vector3, b: Vector3): Vector3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export function vector(v: Vector3, name: string): Vector3 {
  if (!Array.isArray(v) || v.length !== 3)
    throw new TypeError(`${name} needs three numbers`);
  v.forEach((n) => finite(n, name));
  return v;
}

export function validatePlane(p: Plane): Plane {
  if (typeof p?.frameId !== "string" || !p.frameId)
    throw new TypeError("Plane needs an explicit coordinate frameId");
  vector(p.topLeft, "plane.topLeft");
  vector(p.right, "plane.right");
  vector(p.down, "plane.down");
  positive(p.widthMeters, "plane.widthMeters");
  positive(p.heightMeters, "plane.heightMeters");
  if (p.static !== undefined && typeof p.static !== "boolean")
    throw new TypeError("plane.static must be boolean");
  if (
    Math.abs(dot(p.right, p.right) - 1) > 1e-6 ||
    Math.abs(dot(p.down, p.down) - 1) > 1e-6 ||
    Math.abs(dot(p.right, p.down)) > 1e-6
  )
    throw new RangeError("Plane axes must be orthonormal unit vectors");
  return p;
}

/**
 * Coordinates in the registered rectangle, whose logical dimensions are width/height.
 * This two-sided geometric operation does not infer occlusion or physical visibility.
 * It does not subtract a viewport's full-display offset.
 * Directions point away from the measured eye origin; no camera-centre origin is inferred.
 */
export function projectRay(
  ray: Ray,
  plane: Plane | undefined,
  width: number,
  height: number,
): RayProjection {
  if (!plane) return { reason: "missing-plane" };
  validatePlane(plane);
  positive(width, "viewport width");
  positive(height, "viewport height");
  vector(ray.origin, "ray.origin");
  vector(ray.direction, "ray.direction");
  if (ray.frameId !== plane.frameId)
    return { reason: "coordinate-frame-mismatch" };
  const magnitude = Math.max(...ray.direction.map(Math.abs));
  if (magnitude === 0) return { reason: "zero-ray" };
  const scaled = ray.direction.map((n) => n / magnitude) as Vector3;
  const direction = multiply(scaled, 1 / Math.hypot(...scaled));
  const normal = cross(plane.right, plane.down);
  const denominator = dot(direction, normal);
  if (Math.abs(denominator) < 1e-9) return { reason: "parallel-ray" };
  const distanceMeters =
    dot(sub(plane.topLeft, ray.origin), normal) / denominator;
  if (!Number.isFinite(distanceMeters))
    return { reason: "non-finite-projection" };
  if (distanceMeters <= 0) return { reason: "ray-behind-plane" };
  const hit = add(ray.origin, multiply(direction, distanceMeters));
  const offset = sub(hit, plane.topLeft);
  const result = {
    point: {
      x: (dot(offset, plane.right) / plane.widthMeters) * width,
      y: (dot(offset, plane.down) / plane.heightMeters) * height,
    },
    hit,
    distanceMeters,
  };
  if (![...hit, result.point.x, result.point.y].every(Number.isFinite))
    return { reason: "non-finite-projection" };
  return result;
}

/** A named rigid change of coordinates: p_target = R * p_source + translation. */
export function validateRigidTransform(
  transform: RigidTransform,
): RigidTransform {
  for (const key of ["fromFrameId", "toFrameId"] as const)
    if (typeof transform?.[key] !== "string" || !transform[key])
      throw new TypeError(`${key} must identify a coordinate frame`);
  const r = transform.rotation;
  if (!Array.isArray(r) || r.length !== 9)
    throw new TypeError("rotation must be a row-major 3x3 matrix");
  r.forEach((n) => finite(n, "rotation coefficient"));
  vector(transform.translation, "translation in metres");
  if (transform.static !== undefined && typeof transform.static !== "boolean")
    throw new TypeError("transform.static must be boolean");
  const rows = [r.slice(0, 3), r.slice(3, 6), r.slice(6, 9)] as Vector3[];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      if (Math.abs(dot(rows[i], rows[j]) - (i === j ? 1 : 0)) > 1e-6)
        throw new RangeError(
          "rotation must be orthonormal; scale and shear are not rigid transforms",
        );
  const determinant = dot(rows[0], cross(rows[1], rows[2]));
  if (Math.abs(determinant - 1) > 1e-6)
    throw new RangeError(
      "rotation must have determinant +1; reflections require an explicit convention conversion",
    );
  return transform;
}
const rotate3D = (v: Vector3, r: Matrix3): Vector3 => [
  dot(r.slice(0, 3) as Vector3, v),
  dot(r.slice(3, 6) as Vector3, v),
  dot(r.slice(6, 9) as Vector3, v),
];

export function transformPoint3D(
  p: Vector3,
  transform: RigidTransform,
): Vector3 {
  validateRigidTransform(transform);
  vector(p, "source point");
  return vector(
    add(rotate3D(p, transform.rotation), transform.translation),
    "transformed point",
  );
}

/** A direction has homogeneous coordinate zero: translation must never be applied. */
export function transformDirection3D(
  direction: Vector3,
  transform: RigidTransform,
): Vector3 {
  validateRigidTransform(transform);
  vector(direction, "source direction");
  return vector(
    rotate3D(direction, transform.rotation),
    "transformed direction",
  );
}

export function transformRay(ray: Ray, transform: RigidTransform): Ray {
  validateRigidTransform(transform);
  if (ray.frameId !== transform.fromFrameId)
    throw new Error("Ray frameId does not match transform.fromFrameId");
  return {
    frameId: transform.toFrameId,
    origin: transformPoint3D(ray.origin, transform),
    direction: transformDirection3D(ray.direction, transform),
  };
}

export function transformPlane(plane: Plane, transform: RigidTransform): Plane {
  validatePlane(plane);
  validateRigidTransform(transform);
  if (plane.frameId !== transform.fromFrameId)
    throw new Error("Plane frameId does not match transform.fromFrameId");
  return {
    ...plane,
    frameId: transform.toFrameId,
    topLeft: transformPoint3D(plane.topLeft, transform),
    right: transformDirection3D(plane.right, transform),
    down: transformDirection3D(plane.down, transform),
    static: plane.static === true && transform.static === true,
  };
}

/** Invert an extrinsic mapping; in particular camera position is -R^T t, not t. */
export function invertRigidTransform(
  transform: RigidTransform,
): RigidTransform {
  validateRigidTransform(transform);
  const r = transform.rotation,
    rotation: Matrix3 = [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]];
  return {
    fromFrameId: transform.toFrameId,
    toFrameId: transform.fromFrameId,
    rotation,
    translation: vector(
      multiply(rotate3D(transform.translation, rotation), -1),
      "inverse translation",
    ),
    ...(transform.static === undefined ? {} : { static: transform.static }),
  };
}
