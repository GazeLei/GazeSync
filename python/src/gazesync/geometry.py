"""Pure geometry in logical pixels and metres; no device or model dependencies."""

from __future__ import annotations

import math
import sys
from typing import Any, Mapping, Sequence

Point = dict[str, float]
View = dict[str, Any]
Vector3 = Sequence[float]


def finite(value: float, name: str) -> float:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
    ):
        raise ValueError(f"{name} must be finite")
    return value


def positive(value: float, name: str) -> float:
    if finite(value, name) <= 0:
        raise ValueError(f"{name} must be positive")
    return value


def point(value: Mapping[str, float], name: str = "point") -> Mapping[str, float]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{name} must contain x and y")
    finite(value.get("x"), f"{name}.x")
    finite(value.get("y"), f"{name}.y")
    return value


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def fit_scale(view: Mapping[str, Any]) -> float:
    return min(
        view["width"] / view["contentWidth"], view["height"] / view["contentHeight"]
    )


def zoom_level(view: Mapping[str, Any]) -> float:
    return view["scale"] / fit_scale(view)


def view_matrix(view: Mapping[str, Any]) -> list[float]:
    angle = finite(view.get("rotation", 0), "view rotation")
    a, b = view["scale"] * math.cos(angle), view["scale"] * math.sin(angle)
    return [a, b, -b if b else 0, a, view["tx"], view["ty"]]


def angle_delta(angle: float) -> float:
    return math.atan2(math.sin(angle), math.cos(angle))


def validate_matrix(matrix: Sequence[float]) -> Sequence[float]:
    if not isinstance(matrix, (list, tuple)) or len(matrix) != 6:
        raise ValueError("Affine matrix needs six numbers")
    for n in matrix:
        finite(n, "matrix coefficient")
    magnitude = max(abs(n) for n in matrix[:4])
    if magnitude == 0:
        raise ValueError("Singular or ill-conditioned affine matrix")
    a, b, c, d = (n / magnitude for n in matrix[:4])
    determinant = a * d - b * c
    if (
        not math.isfinite(determinant)
        or abs(determinant) <= 32 * sys.float_info.epsilon
    ):
        raise ValueError("Singular or ill-conditioned affine matrix")
    return matrix


def invert_affine(matrix: Sequence[float]) -> list[float]:
    validate_matrix(matrix)
    magnitude = max(abs(n) for n in matrix[:4])
    a, b, c, d = (n / magnitude for n in matrix[:4])
    determinant = a * d - b * c
    inverse = [
        d / determinant / magnitude,
        -b / determinant / magnitude,
        -c / determinant / magnitude,
        a / determinant / magnitude,
    ]
    inverse.extend(
        [
            -inverse[0] * matrix[4] - inverse[2] * matrix[5],
            -inverse[1] * matrix[4] - inverse[3] * matrix[5],
        ]
    )
    for n in inverse:
        finite(n, "inverse affine coefficient")
    return inverse


def apply_affine(matrix: Sequence[float], p: Mapping[str, float]) -> Point:
    result = {
        "x": matrix[0] * p["x"] + matrix[2] * p["y"] + matrix[4],
        "y": matrix[1] * p["x"] + matrix[3] * p["y"] + matrix[5],
    }
    point(result, "affine output")
    return result


def constrain(view: Mapping[str, Any]) -> View:
    scale = clamp(
        view["scale"],
        fit_scale(view) * view["minZoom"],
        fit_scale(view) * view["maxZoom"],
    )
    positive(scale, "view scale")
    finite(view.get("rotation", 0), "view rotation")
    if view.get("panBounds", "content") not in ("content", "none"):
        raise ValueError("panBounds must be content or none")
    finite(view["tx"], "view tx")
    finite(view["ty"], "view ty")
    result = {**view, "scale": scale}
    if view.get("panBounds") == "none":
        return result
    a, b, c, d = view_matrix(result)[:4]
    cw, ch = view["contentWidth"], view["contentHeight"]
    xs, ys = [0, a * cw, c * ch, a * cw + c * ch], [0, b * cw, d * ch, b * cw + d * ch]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    positive(x1 - x0, "rendered width")
    positive(y1 - y0, "rendered height")
    return {
        **result,
        "tx": (
            (view["width"] - x0 - x1) / 2
            if x1 - x0 <= view["width"]
            else clamp(view["tx"], view["width"] - x1, -x0)
        ),
        "ty": (
            (view["height"] - y0 - y1) / 2
            if y1 - y0 <= view["height"]
            else clamp(view["ty"], view["height"] - y1, -y0)
        ),
    }


def create_view(
    width: float,
    height: float,
    content_width: float,
    content_height: float,
    min_zoom: float = 1,
    max_zoom: float = 16,
    *,
    rotation: float = 0,
    pan_bounds: str = "content",
) -> View:
    values = {
        "width": width,
        "height": height,
        "contentWidth": content_width,
        "contentHeight": content_height,
        "minZoom": min_zoom,
        "maxZoom": max_zoom,
    }
    for key, value in values.items():
        positive(value, key)
    if min_zoom > 1 or max_zoom < 1:
        raise ValueError("Zoom limits must include original fit (1)")
    finite(rotation, "rotation")
    values.update(rotation=rotation, panBounds=pan_bounds)
    scale = fit_scale(values)
    a, b, c, d = view_matrix({**values, "scale": scale, "tx": 0, "ty": 0})[:4]
    return constrain(
        {
            **values,
            "scale": scale,
            "tx": width / 2 - (a * content_width + c * content_height) / 2,
            "ty": height / 2 - (b * content_width + d * content_height) / 2,
        }
    )


def reset_view(view: Mapping[str, Any]) -> View:
    scale = fit_scale(view)
    return constrain(
        {
            **view,
            "rotation": 0,
            "scale": scale,
            "tx": (view["width"] - view["contentWidth"] * scale) / 2,
            "ty": (view["height"] - view["contentHeight"] * scale) / 2,
        }
    )


def content_to_viewport(view: Mapping[str, Any], p: Mapping[str, float]) -> Point:
    point(p)
    return apply_affine(view_matrix(view), p)


def viewport_to_content(view: Mapping[str, Any], p: Mapping[str, float]) -> Point:
    point(p)
    return apply_affine(invert_affine(view_matrix(view)), p)


def transform_at(
    view: Mapping[str, Any],
    factor: float,
    radians: float,
    anchor: Mapping[str, float],
    destination: Mapping[str, float] | None = None,
) -> View:
    """Clockwise radians, combined with zoom and movement before bounding once."""
    positive(factor, "zoom factor")
    finite(radians, "rotation delta")
    destination = anchor if destination is None else destination
    point(destination)
    p = viewport_to_content(view, anchor)
    scale = clamp(
        view["scale"] * factor,
        fit_scale(view) * view["minZoom"],
        fit_scale(view) * view["maxZoom"],
    )
    rotation = angle_delta(view.get("rotation", 0) + radians)
    result = {**view, "scale": scale, "rotation": rotation, "tx": 0, "ty": 0}
    offset = content_to_viewport(result, p)
    return constrain(
        {
            **result,
            "tx": destination["x"] - offset["x"],
            "ty": destination["y"] - offset["y"],
        }
    )


def zoom_at(
    view: Mapping[str, Any],
    factor: float,
    anchor: Mapping[str, float],
    destination: Mapping[str, float] | None = None,
) -> View:
    return transform_at(view, factor, 0, anchor, destination)


def rotate_at(
    view: Mapping[str, Any], radians: float, anchor: Mapping[str, float] | None = None
) -> View:
    anchor = (
        {"x": view["width"] / 2, "y": view["height"] / 2} if anchor is None else anchor
    )
    return transform_at(view, 1, radians, anchor)


def pan_by(view: Mapping[str, Any], dx: float, dy: float) -> View:
    finite(dx, "dx")
    finite(dy, "dy")
    return constrain({**view, "tx": view["tx"] + dx, "ty": view["ty"] + dy})


def zoom_to_box(
    view: Mapping[str, Any],
    start: Mapping[str, float],
    end: Mapping[str, float],
    minimum_size: float = 6,
) -> View:
    point(start)
    point(end)
    positive(minimum_size, "minimum box size")
    x0, x1 = [clamp(v, 0, view["width"]) for v in sorted([start["x"], end["x"]])]
    y0, y1 = [clamp(v, 0, view["height"]) for v in sorted([start["y"], end["y"]])]
    if x1 - x0 < minimum_size or y1 - y0 < minimum_size:
        return dict(view)
    return zoom_at(
        view,
        min(view["width"] / (x1 - x0), view["height"] / (y1 - y0)),
        {"x": (x0 + x1) / 2, "y": (y0 + y1) / 2},
        {"x": view["width"] / 2, "y": view["height"] / 2},
    )


def resize_view(view: Mapping[str, Any], width: float, height: float) -> View:
    positive(width, "width")
    positive(height, "height")
    center = viewport_to_content(
        view, {"x": view["width"] / 2, "y": view["height"] / 2}
    )
    result = {**view, "width": width, "height": height}
    scale = fit_scale(result) * zoom_level(view)
    offset = content_to_viewport({**result, "scale": scale, "tx": 0, "ty": 0}, center)
    return constrain(
        {
            **result,
            "scale": scale,
            "tx": width / 2 - offset["x"],
            "ty": height / 2 - offset["y"],
        }
    )


def vector(value: Sequence[float], name: str) -> Sequence[float]:
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise ValueError(f"{name} needs three numbers")
    for n in value:
        finite(n, name)
    return value


def dot(a: Vector3, b: Vector3) -> float:
    return sum(x * y for x, y in zip(a, b))


def cross(a: Vector3, b: Vector3) -> list[float]:
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]


def validate_plane(plane: Mapping[str, Any]) -> Mapping[str, Any]:
    if not isinstance(plane.get("frameId"), str) or not plane["frameId"]:
        raise ValueError("Plane needs an explicit coordinate frameId")
    for key in ("topLeft", "right", "down"):
        vector(plane.get(key), "plane." + key)
    for key in ("widthMeters", "heightMeters"):
        positive(plane.get(key), "plane." + key)
    if "static" in plane and not isinstance(plane["static"], bool):
        raise ValueError("plane.static must be boolean")
    if (
        abs(dot(plane["right"], plane["right"]) - 1) > 1e-6
        or abs(dot(plane["down"], plane["down"]) - 1) > 1e-6
        or abs(dot(plane["right"], plane["down"])) > 1e-6
    ):
        raise ValueError("Plane axes must be orthonormal unit vectors")
    return plane


def project_ray(
    ray: Mapping[str, Any], plane: Mapping[str, Any] | None, width: float, height: float
) -> dict[str, Any]:
    if plane is None:
        return {"reason": "missing-plane"}
    validate_plane(plane)
    positive(width, "viewport width")
    positive(height, "viewport height")
    vector(ray.get("origin"), "ray.origin")
    vector(ray.get("direction"), "ray.direction")
    if ray.get("frameId") != plane["frameId"]:
        return {"reason": "coordinate-frame-mismatch"}
    magnitude = max(abs(n) for n in ray["direction"])
    if magnitude == 0:
        return {"reason": "zero-ray"}
    scaled = [n / magnitude for n in ray["direction"]]
    norm = math.hypot(*scaled)
    direction = [n / norm for n in scaled]
    normal = cross(plane["right"], plane["down"])
    denominator = dot(direction, normal)
    if abs(denominator) < 1e-9:
        return {"reason": "parallel-ray"}
    distance = (
        dot([a - b for a, b in zip(plane["topLeft"], ray["origin"])], normal)
        / denominator
    )
    if not math.isfinite(distance):
        return {"reason": "non-finite-projection"}
    if distance <= 0:
        return {"reason": "ray-behind-plane"}
    hit = [a + b * distance for a, b in zip(ray["origin"], direction)]
    offset = [a - b for a, b in zip(hit, plane["topLeft"])]
    p = {
        "x": dot(offset, plane["right"]) / plane["widthMeters"] * width,
        "y": dot(offset, plane["down"]) / plane["heightMeters"] * height,
    }
    if not all(math.isfinite(n) for n in [*hit, p["x"], p["y"]]):
        return {"reason": "non-finite-projection"}
    return {"point": p, "hit": hit, "distanceMeters": distance}


def validate_rigid_transform(transform: Mapping[str, Any]) -> Mapping[str, Any]:
    """Validate p_target = R p_source + t; row-major R, translation in metres."""
    if not isinstance(transform, Mapping):
        raise ValueError("Rigid transform must be a mapping")
    for key in ("fromFrameId", "toFrameId"):
        if not isinstance(transform.get(key), str) or not transform[key]:
            raise ValueError(f"{key} must identify a coordinate frame")
    r = transform.get("rotation")
    if not isinstance(r, (list, tuple)) or len(r) != 9:
        raise ValueError("rotation must be a row-major 3x3 matrix")
    for n in r:
        finite(n, "rotation coefficient")
    vector(transform.get("translation"), "translation in metres")
    if "static" in transform and not isinstance(transform["static"], bool):
        raise ValueError("transform.static must be boolean")
    rows = [r[0:3], r[3:6], r[6:9]]
    for i in range(3):
        for j in range(3):
            if abs(dot(rows[i], rows[j]) - (1 if i == j else 0)) > 1e-6:
                raise ValueError(
                    "rotation must be orthonormal; scale and shear are not rigid transforms"
                )
    if abs(dot(rows[0], cross(rows[1], rows[2])) - 1) > 1e-6:
        raise ValueError(
            "rotation must have determinant +1; reflections require an explicit convention conversion"
        )
    return transform


def _rotate_3d(v: Vector3, r: Sequence[float]) -> list[float]:
    return [dot(r[0:3], v), dot(r[3:6], v), dot(r[6:9], v)]


def transform_point_3d(p: Vector3, transform: Mapping[str, Any]) -> list[float]:
    validate_rigid_transform(transform)
    vector(p, "source point")
    result = [
        a + b
        for a, b in zip(_rotate_3d(p, transform["rotation"]), transform["translation"])
    ]
    vector(result, "transformed point")
    return result


def transform_direction_3d(
    direction: Vector3, transform: Mapping[str, Any]
) -> list[float]:
    """A direction has homogeneous coordinate zero; translation never applies."""
    validate_rigid_transform(transform)
    vector(direction, "source direction")
    result = _rotate_3d(direction, transform["rotation"])
    vector(result, "transformed direction")
    return result


def transform_ray(
    ray: Mapping[str, Any], transform: Mapping[str, Any]
) -> dict[str, Any]:
    validate_rigid_transform(transform)
    if ray.get("frameId") != transform["fromFrameId"]:
        raise ValueError("Ray frameId does not match transform.fromFrameId")
    return dict(
        frameId=transform["toFrameId"],
        origin=transform_point_3d(ray["origin"], transform),
        direction=transform_direction_3d(ray["direction"], transform),
    )


def transform_plane(
    plane: Mapping[str, Any], transform: Mapping[str, Any]
) -> dict[str, Any]:
    validate_plane(plane)
    validate_rigid_transform(transform)
    if plane["frameId"] != transform["fromFrameId"]:
        raise ValueError("Plane frameId does not match transform.fromFrameId")
    return {
        **plane,
        "frameId": transform["toFrameId"],
        "topLeft": transform_point_3d(plane["topLeft"], transform),
        "right": transform_direction_3d(plane["right"], transform),
        "down": transform_direction_3d(plane["down"], transform),
        "static": plane.get("static") is True and transform.get("static") is True,
    }


def invert_rigid_transform(transform: Mapping[str, Any]) -> dict[str, Any]:
    """Invert extrinsics: camera position in the source frame is -R^T t, not t."""
    validate_rigid_transform(transform)
    r = transform["rotation"]
    rotation = [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]]
    translation = [-n for n in _rotate_3d(transform["translation"], rotation)]
    vector(translation, "inverse translation")
    return dict(
        fromFrameId=transform["toFrameId"],
        toFrameId=transform["fromFrameId"],
        rotation=rotation,
        translation=translation,
        **({"static": transform["static"]} if "static" in transform else {}),
    )
