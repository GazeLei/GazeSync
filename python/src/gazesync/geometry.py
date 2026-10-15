"""Pure geometry in logical pixels and metres; no device or model dependencies."""

from __future__ import annotations

import math
import sys
from typing import Any, Mapping, Sequence

Point = dict[str, float]
View = dict[str, float]
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


def fit_scale(view: Mapping[str, float]) -> float:
    return min(
        view["width"] / view["contentWidth"], view["height"] / view["contentHeight"]
    )


def zoom_level(view: Mapping[str, float]) -> float:
    return view["scale"] / fit_scale(view)


def view_matrix(view: Mapping[str, float]) -> list[float]:
    return [view["scale"], 0, 0, view["scale"], view["tx"], view["ty"]]


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


def constrain(view: Mapping[str, float]) -> View:
    scale = clamp(
        view["scale"],
        fit_scale(view) * view["minZoom"],
        fit_scale(view) * view["maxZoom"],
    )
    width, height = view["contentWidth"] * scale, view["contentHeight"] * scale
    positive(scale, "view scale")
    positive(width, "rendered width")
    positive(height, "rendered height")
    finite(view["tx"], "view tx")
    finite(view["ty"], "view ty")
    return {
        **view,
        "scale": scale,
        "tx": (view["width"] - width) / 2
        if width <= view["width"]
        else clamp(view["tx"], view["width"] - width, 0),
        "ty": (view["height"] - height) / 2
        if height <= view["height"]
        else clamp(view["ty"], view["height"] - height, 0),
    }


def create_view(
    width: float,
    height: float,
    content_width: float,
    content_height: float,
    min_zoom: float = 1,
    max_zoom: float = 16,
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
    return constrain({**values, "scale": fit_scale(values), "tx": 0, "ty": 0})


def reset_view(view: Mapping[str, float]) -> View:
    return constrain({**view, "scale": fit_scale(view), "tx": 0, "ty": 0})


def content_to_viewport(view: Mapping[str, float], p: Mapping[str, float]) -> Point:
    point(p)
    return apply_affine(view_matrix(view), p)


def viewport_to_content(view: Mapping[str, float], p: Mapping[str, float]) -> Point:
    point(p)
    return {
        "x": (p["x"] - view["tx"]) / view["scale"],
        "y": (p["y"] - view["ty"]) / view["scale"],
    }


def zoom_at(
    view: Mapping[str, float],
    factor: float,
    anchor: Mapping[str, float],
    destination: Mapping[str, float] | None = None,
) -> View:
    positive(factor, "zoom factor")
    destination = anchor if destination is None else destination
    point(destination)
    p = viewport_to_content(view, anchor)
    scale = clamp(
        view["scale"] * factor,
        fit_scale(view) * view["minZoom"],
        fit_scale(view) * view["maxZoom"],
    )
    return constrain(
        {
            **view,
            "scale": scale,
            "tx": destination["x"] - p["x"] * scale,
            "ty": destination["y"] - p["y"] * scale,
        }
    )


def pan_by(view: Mapping[str, float], dx: float, dy: float) -> View:
    finite(dx, "dx")
    finite(dy, "dy")
    return constrain({**view, "tx": view["tx"] + dx, "ty": view["ty"] + dy})


def zoom_to_box(
    view: Mapping[str, float],
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


def resize_view(view: Mapping[str, float], width: float, height: float) -> View:
    positive(width, "width")
    positive(height, "height")
    center = viewport_to_content(
        view, {"x": view["width"] / 2, "y": view["height"] / 2}
    )
    result = {**view, "width": width, "height": height}
    scale = fit_scale(result) * zoom_level(view)
    return constrain(
        {
            **result,
            "scale": scale,
            "tx": width / 2 - center["x"] * scale,
            "ty": height / 2 - center["y"] * scale,
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
