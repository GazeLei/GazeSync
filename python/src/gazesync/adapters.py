"""Normalizers for model output, Tobii Pro dictionaries, EyeLink bridges and Pupil Core.

No vendor SDK is imported here. These adapters are fixture-tested, not hardware-certified.
"""

from __future__ import annotations
import math
import copy
import struct
from collections import OrderedDict
from typing import Any, Mapping
from .diagnostics import DIAGNOSTIC_CATALOG
from .geometry import finite, positive
from .records import json_record


def _choice(value: Any, allowed: tuple[str, ...], name: str) -> None:
    if value not in allowed:
        raise ValueError(f"{name} must be one of {', '.join(allowed)}")


def _object(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _field(record: Mapping[str, Any], path: str) -> Any:
    value = record
    for key in path.split("."):
        value = _object(value).get(key)
    return value


def _numbers(value: Any, length: int) -> list[float] | None:
    if not isinstance(value, (list, tuple)) or len(value) != length:
        return None
    if any(
        isinstance(n, bool) or not isinstance(n, (float, int)) or not math.isfinite(n)
        for n in value
    ):
        return None
    return list(value)


def _coordinates(value: Any) -> dict[str, float] | None:
    a = _numbers(value, 2)
    if a is not None:
        return {"x": a[0], "y": a[1]}
    obj = _object(value)
    a = _numbers([obj.get("x"), obj.get("y")], 2)
    return None if a is None else {"x": a[0], "y": a[1]}


def _confidence(value: Any) -> float | None:
    if value is None:
        return None
    finite(value, "confidence")
    if not 0 <= value <= 1:
        raise ValueError("Confidence must be null or a number in [0,1]")
    return value


def _stamp(value: float) -> str:
    return struct.pack(">d", 0.0 if value == 0 else value).hex()


def _identifier(value: Any) -> str:
    if isinstance(value, str) and value:
        return value
    if (
        not isinstance(value, bool)
        and isinstance(value, (int, float))
        and math.isfinite(value)
        and float(value).is_integer()
        and abs(value) <= 2**53 - 1
    ):
        return str(int(value))
    raise ValueError("A provided sample ID must be a nonempty string or safe integer")


def timestamp_to_milliseconds(value: float, unit: str) -> float:
    scale = {"s": 1000, "ms": 1, "us": 0.001, "ns": 0.000001}
    if unit not in scale:
        raise ValueError("Explicit numeric timestamp and supported unit are required")
    finite(value, "timestamp")
    return finite(value * scale[unit], "converted timestamp")


class _Adapter:
    def __init__(
        self,
        options: Mapping[str, Any],
        adapter: str,
        kind: str,
        eyes: list[str],
        mode: str,
        timestamp_kind: str,
    ) -> None:
        self._options = json_record(dict(options))
        options = self._options
        self.sequence = 0
        for key in ("sourceId", "clockId", "clockEpoch", "surfaceId", "surfaceEpoch"):
            if not isinstance(options.get(key), str) or not options[key]:
                raise ValueError(f"{key} is required")
        for key in ("frameId", "deviceModel", "calibrationId"):
            if key in options and (
                not isinstance(options[key], str) or not options[key]
            ):
                raise ValueError(f"{key} must be a nonempty string")
        if not isinstance(options.get("eyeRatesHz", {}), Mapping):
            raise ValueError("eyeRatesHz must be a mapping")
        if "expectedHz" in options:
            positive(options["expectedHz"], "expectedHz")
        if (
            not isinstance(eyes, (list, tuple))
            or not eyes
            or len(set(eyes)) != len(eyes)
            or any(eye not in ("left", "right", "combined", "unknown") for eye in eyes)
        ):
            raise ValueError("Explicit eye selection is required")
        _choice(
            options.get("trackingMode", mode),
            (
                "monocular",
                "binocular-independent",
                "binocular-fused",
                "mixed",
                "unspecified",
            ),
            "trackingMode",
        )
        _choice(
            options.get("timestampKind", timestamp_kind),
            ("exposure", "vendor-estimate", "host-receipt"),
            "timestampKind",
        )
        for eye, hz in options.get("eyeRatesHz", {}).items():
            if eye not in eyes:
                raise ValueError("eyeRatesHz must describe declared eyes")
            positive(hz, "eyeRatesHz")
        self._source = {
            "id": options["sourceId"],
            "kind": kind,
            "adapter": adapter,
            "eyes": list(eyes),
            "trackingMode": options.get("trackingMode", mode),
            "timestampKind": options.get("timestampKind", timestamp_kind),
            "hardwareValidated": False,
            **{
                k: options[k]
                for k in ("expectedHz", "eyeRatesHz", "deviceModel", "calibrationId")
                if k in options
            },
        }

    @property
    def source(self) -> dict[str, Any]:
        """Detached registration metadata; adapter configuration is a construction-time snapshot."""
        return copy.deepcopy(self._source)

    def _base(
        self,
        sample_id: str,
        t: float,
        eye: str,
        kind: str,
        score: float | None,
        valid: bool,
        context: Mapping[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        c = {**self._options, **(context or {})}
        return {
            "id": sample_id,
            "captureId": sample_id,
            "sourceId": self._options["sourceId"],
            "eye": eye,
            "type": kind,
            "clockId": c["clockId"],
            "clockEpoch": c["clockEpoch"],
            "timeMs": t,
            "surfaceId": c["surfaceId"],
            "surfaceEpoch": c["surfaceEpoch"],
            "confidence": score,
            "valid": valid,
            **({"calibrationId": c["calibrationId"]} if c.get("calibrationId") else {}),
            "metadata": {"adapter": self._source["adapter"], **(metadata or {})},
        }

    def _warning(self, code: str, eye: str | None = None) -> dict[str, Any]:
        return {
            "code": code,
            **DIAGNOSTIC_CATALOG[code],
            "sourceId": self._options["sourceId"],
            **({"eye": eye} if eye else {}),
        }

    def _partial(
        self, samples: list[dict[str, Any]], warnings: list[dict[str, Any]]
    ) -> None:
        if all(eye in self._source["eyes"] for eye in ("left", "right")) and any(
            not any(s["eye"] == eye and s["valid"] for s in samples)
            for eye in ("left", "right")
        ):
            warnings.append(self._warning("BINOCULAR_PARTIAL"))


class ModelAdapter(_Adapter):
    def __init__(self, options: Mapping[str, Any]) -> None:
        eye = options["eye"]
        super().__init__(
            options,
            "generic-model-v1",
            "model",
            options.get("eyes", [eye]),
            "unspecified" if eye in ("combined", "unknown") else "monocular",
            "vendor-estimate",
        )
        options = self._options
        _choice(options.get("type"), ("pog2d", "ray3d", "direction3d"), "type")
        _choice(options.get("timestampUnit"), ("s", "ms", "us", "ns"), "timestampUnit")
        _choice(
            options.get("pointUnits", "normalized-viewport"),
            ("viewport", "normalized-viewport", "normalized-display", "display-pixels"),
            "pointUnits",
        )
        _choice(options.get("originUnits", "m"), ("m", "mm"), "originUnits")
        _choice(options.get("yOrigin", "top"), ("top", "bottom"), "yOrigin")
        if eye not in self._source["eyes"]:
            raise ValueError("Model eye must be included in declared eyes")
        fields = options.get("fields", {})
        if not isinstance(fields, Mapping) or any(
            k
            not in (
                "timestamp",
                "id",
                "point",
                "origin",
                "direction",
                "confidence",
                "valid",
            )
            or not isinstance(v, str)
            or not all(v.split("."))
            for k, v in fields.items()
        ):
            raise ValueError("fields must map known model fields to nonempty dot paths")
        if options["type"] != "pog2d" and (
            not isinstance(options.get("frameId"), str) or not options["frameId"]
        ):
            raise ValueError("frameId is required for a 3D model signal")
        if options.get("pointUnits") == "display-pixels":
            positive(
                options.get("displayPixels", {}).get("width"), "displayPixels.width"
            )
            positive(
                options.get("displayPixels", {}).get("height"), "displayPixels.height"
            )

    def adapt(
        self, record: Mapping[str, Any], context: Mapping[str, Any] | None = None
    ) -> dict[str, Any]:
        o = self._options
        fields = {
            "timestamp": "timestamp",
            "id": "id",
            "point": "point",
            "origin": "origin",
            "direction": "direction",
            "confidence": "confidence",
            "valid": "valid",
            **o.get("fields", {}),
        }
        t = timestamp_to_milliseconds(
            _field(record, fields["timestamp"]), o["timestampUnit"]
        )
        raw_id = _field(record, fields["id"])
        if raw_id is None:
            self.sequence += 1
        sample_id = f"model-{self.sequence}" if raw_id is None else _identifier(raw_id)
        score, status = (
            _confidence(_field(record, fields["confidence"])),
            _field(record, fields["valid"]),
        )
        if status is not None and not isinstance(status, bool):
            raise ValueError("Model validity must be boolean")
        warnings = []
        kind = o["type"]
        if kind == "pog2d":
            p = _coordinates(_field(record, fields["point"]))
            units = o.get("pointUnits", "normalized-viewport")
            if p is not None and units == "display-pixels":
                p = {
                    "x": p["x"] / o["displayPixels"]["width"],
                    "y": p["y"] / o["displayPixels"]["height"],
                }
            if p is not None and o.get("yOrigin") == "bottom":
                if units == "viewport":
                    raise ValueError(
                        "Convert bottom-origin logical coordinates using the measured viewport height before ingestion"
                    )
                p = {"x": p["x"], "y": 1 - p["y"]}
            sample = {
                **self._base(
                    sample_id,
                    t,
                    o["eye"],
                    kind,
                    score,
                    status is not False and p is not None,
                    context,
                ),
                "space": "normalized-display" if units == "display-pixels" else units,
                **({"point": p} if p is not None else {}),
            }
        else:
            direction = _numbers(_field(record, fields["direction"]), 3)
            if kind == "direction3d":
                sample = {
                    **self._base(
                        sample_id,
                        t,
                        o["eye"],
                        kind,
                        score,
                        status is not False and direction is not None,
                        context,
                    ),
                    **(
                        {"direction": direction, "frameId": o["frameId"]}
                        if direction is not None
                        else {}
                    ),
                }
            else:
                origin = _numbers(_field(record, fields["origin"]), 3)
                sample = {
                    **self._base(
                        sample_id,
                        t,
                        o["eye"],
                        kind,
                        score,
                        status is not False
                        and origin is not None
                        and direction is not None,
                        context,
                    ),
                    **(
                        {
                            "ray": {
                                "origin": [
                                    n * (0.001 if o.get("originUnits") == "mm" else 1)
                                    for n in origin
                                ],
                                "direction": direction,
                                "frameId": o["frameId"],
                            }
                        }
                        if origin is not None and direction is not None
                        else {}
                    ),
                }
                if origin is None or direction is None:
                    warnings.append(self._warning("GEOMETRY_UNAVAILABLE", o["eye"]))
        return {"samples": [sample], "warnings": warnings}


class TobiiProAdapter(_Adapter):
    def __init__(self, options: Mapping[str, Any]) -> None:
        eyes = options.get("eyes", ["left", "right"])
        super().__init__(
            options,
            "tobii-pro-dictionary-v1",
            "tracker",
            eyes,
            "monocular" if len(eyes) == 1 else "binocular-independent",
            "vendor-estimate",
        )
        if "timestamp" in options:
            _choice(options["timestamp"], ("device", "system"), "timestamp")
        if "includeRay" in options and not isinstance(options["includeRay"], bool):
            raise ValueError("includeRay must be boolean")
        if any(eye not in ("left", "right") for eye in eyes):
            raise ValueError("Tobii per-eye channels must be left or right")
        if options.get("includeRay") and not options.get("frameId"):
            raise ValueError("Declare the Tobii UCS frameId before enabling rays")

    def adapt(
        self, record: Mapping[str, Any], context: Mapping[str, Any] | None = None
    ) -> dict[str, Any]:
        o = self._options
        raw_time = record.get(
            "system_time_stamp"
            if o.get("timestamp") == "system"
            else "device_time_stamp"
        )
        t = timestamp_to_milliseconds(raw_time, "us")
        sample_id = (
            _identifier(record["id"]) if "id" in record else f"tobii-{_stamp(t)}"
        )
        samples, warnings = [], []
        for eye in self._source["eyes"]:
            p = _coordinates(record.get(f"{eye}_gaze_point_on_display_area"))
            valid = (
                record.get(f"{eye}_gaze_point_validity") in (True, 1) and p is not None
            )
            samples.append(
                {
                    **self._base(sample_id, t, eye, "pog2d", None, valid, context),
                    "space": "normalized-display",
                    **({"point": p} if p is not None else {}),
                }
            )
            if o.get("includeRay"):
                origin, hit = (
                    _numbers(
                        record.get(f"{eye}_gaze_origin_in_user_coordinate_system"), 3
                    ),
                    _numbers(
                        record.get(f"{eye}_gaze_point_in_user_coordinate_system"), 3
                    ),
                )
                ray_valid = (
                    valid
                    and record.get(f"{eye}_gaze_origin_validity") in (True, 1)
                    and origin is not None
                    and hit is not None
                )
                samples.append(
                    {
                        **self._base(
                            sample_id,
                            t,
                            eye,
                            "ray3d",
                            None,
                            ray_valid,
                            context,
                            {"rayDefinition": "eye-origin-to-vendor-display-point"},
                        ),
                        **(
                            {
                                "ray": {
                                    "origin": [n / 1000 for n in origin],
                                    "direction": [
                                        (n - origin[i]) / 1000
                                        for i, n in enumerate(hit)
                                    ],
                                    "frameId": o["frameId"],
                                }
                            }
                            if origin is not None and hit is not None
                            else {}
                        ),
                    }
                )
                if not ray_valid:
                    warnings.append(self._warning("GEOMETRY_UNAVAILABLE", eye))
        self._partial(samples, warnings)
        return {"samples": samples, "warnings": warnings}


class EyeLinkAdapter(_Adapter):
    def __init__(self, options: Mapping[str, Any]) -> None:
        eyes = options.get("eyes", ["left", "right"])
        super().__init__(
            options,
            "eyelink-bridge-v1",
            "tracker",
            eyes,
            "monocular" if len(eyes) == 1 else "binocular-independent",
            "exposure",
        )
        if any(eye not in ("left", "right") for eye in eyes):
            raise ValueError("EyeLink per-eye channels must be left or right")
        for key in ("width", "height"):
            positive(options.get("displayPixels", {}).get(key), "displayPixels." + key)

    def adapt(
        self, record: Mapping[str, Any], context: Mapping[str, Any] | None = None
    ) -> dict[str, Any]:
        o = self._options
        t = timestamp_to_milliseconds(record.get("timeMs"), "ms")
        if "id" not in record:
            self.sequence += 1
        sample_id = (
            _identifier(record["id"]) if "id" in record else f"eyelink-{self.sequence}"
        )
        samples, warnings = [], []
        for eye in self._source["eyes"]:
            data = _object(record.get(eye))
            p = _coordinates(data.get("gaze"))
            missing = o.get("missingValue", -32768)
            if "valid" in data and not isinstance(data["valid"], bool):
                raise ValueError("EyeLink bridge validity must be boolean")
            valid = (
                data.get("valid") is not False
                and p is not None
                and p["x"] != missing
                and p["y"] != missing
            )
            pupil = data.get("pupilSize")
            metadata = (
                {"pupilSize": pupil, "pupilUnit": "vendor-configured"}
                if isinstance(pupil, (int, float))
                and not isinstance(pupil, bool)
                and math.isfinite(pupil)
                else {}
            )
            samples.append(
                {
                    **self._base(
                        sample_id, t, eye, "pog2d", None, valid, context, metadata
                    ),
                    "space": "normalized-display",
                    **(
                        {
                            "point": {
                                "x": p["x"] / o["displayPixels"]["width"],
                                "y": p["y"] / o["displayPixels"]["height"],
                            }
                        }
                        if p is not None and p["x"] != missing and p["y"] != missing
                        else {}
                    ),
                }
            )
        self._partial(samples, warnings)
        return {"samples": samples, "warnings": warnings}

    @staticmethod
    def packet_from_pylink(sample: Any, sample_id: str) -> dict[str, Any]:
        """Call once per newly received PyLink sample. PyLink itself is user-installed."""
        result = {"id": sample_id, "timeMs": sample.getTime()}
        for eye, available, getter in (
            ("left", sample.isLeftSample(), sample.getLeftEye),
            ("right", sample.isRightSample(), sample.getRightEye),
        ):
            if available:
                data = getter()
                result[eye] = {
                    "gaze": list(data.getGaze()),
                    "pupilSize": data.getPupilSize(),
                }
        return result


def _normalized_homography(value: Any) -> list[float]:
    coefficients = _numbers(value, 9)
    if coefficients is None:
        raise ValueError("Homography needs nine finite numbers")
    magnitude = max(abs(n) for n in coefficients)
    if magnitude == 0:
        raise ValueError("Homography must be nonsingular")
    normalized = [n / magnitude for n in coefficients]
    a, b, c, d, e, f, g, h, i = normalized
    determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
    if abs(determinant) <= 32 * math.ulp(1.0):
        raise ValueError("Singular or ill-conditioned homography")
    return normalized


class PupilCoreAdapter(_Adapter):
    def __init__(self, options: Mapping[str, Any]) -> None:
        super().__init__(
            options,
            "pupil-core-datum-v1",
            "tracker",
            options.get("eyes", ["left", "right", "combined"]),
            "mixed",
            "vendor-estimate",
        )
        options = self._options
        h = options.get("sceneToSurface")
        self._homography = None
        if h is not None:
            if (
                not isinstance(options.get("mappingId"), str)
                or not options["mappingId"]
            ):
                raise ValueError("A calibrated homography needs a nonempty mappingId")
            self._homography = _normalized_homography(h)
        if "maxMappingSkewMs" in options:
            positive(options["maxMappingSkewMs"], "maxMappingSkewMs")
        self._seen: OrderedDict[Any, bool] = OrderedDict()

    def adapt(
        self, record: Mapping[str, Any], context: Mapping[str, Any] | None = None
    ) -> dict[str, Any]:
        o = self._options
        context = {} if context is None else context
        t = timestamp_to_milliseconds(record.get("timestamp"), "s")
        topic = str(record.get("topic", ""))
        samples, warnings = [], []
        staged_keys = []
        bases = [_object(b) for b in record.get("base_data", [])]
        binocular = ".01." in topic
        ids = (
            ["0", "1"]
            if binocular
            else ["0"]
            if ".0." in topic
            else ["1"]
            if ".1." in topic
            else []
        )
        for eye_id in ids:
            eye = "right" if eye_id == "0" else "left"
            if eye not in self._source["eyes"]:
                continue
            base = next((b for b in bases if str(b.get("id")) == eye_id), {})
            eye_time = (
                t
                if base.get("timestamp") is None
                else timestamp_to_milliseconds(base["timestamp"], "s")
            )
            origin = _numbers(
                _object(record.get("eye_centers_3d")).get(eye_id)
                if binocular
                else record.get("eye_center_3d"),
                3,
            )
            direction = _numbers(
                _object(record.get("gaze_normals_3d")).get(eye_id)
                if binocular
                else record.get("gaze_normal_3d"),
                3,
            )
            if origin is None or direction is None or not o.get("frameId"):
                warnings.append(self._warning("GEOMETRY_UNAVAILABLE", eye))
                continue
            label = _stamp(eye_time)
            capture_id = f"pupil-{eye}-{label}"
            key = (
                context.get("clockId", o["clockId"]),
                context.get("clockEpoch", o["clockEpoch"]),
                capture_id,
            )
            if o.get("deduplicateEyes") is not False and (
                key in self._seen or key in staged_keys
            ):
                warnings.append(self._warning("REUSED_EYE_SAMPLE", eye))
                continue
            staged_keys.append(key)
            score = base.get("confidence", record.get("confidence"))
            samples.append(
                {
                    **self._base(
                        capture_id,
                        eye_time,
                        eye,
                        "ray3d",
                        _confidence(score),
                        True,
                        context,
                        {"vendorTopic": topic, "vendorGazeTimeMs": t},
                    ),
                    "ray": {
                        "origin": [n / 1000 for n in origin],
                        "direction": direction,
                        "frameId": o["frameId"],
                    },
                }
            )
        p = _coordinates(record.get("norm_pos"))
        eye = (
            "combined"
            if binocular
            else "right"
            if ids == ["0"]
            else "left"
            if ids == ["1"]
            else "unknown"
        )
        if p is not None and eye in self._source["eyes"]:
            h = self._homography
            if h is None:
                warnings.append(self._warning("SURFACE_REGISTRATION_REQUIRED", eye))
            else:
                x, y = p["x"], 1 - p["y"]
                w = h[6] * x + h[7] * y + h[8]
                mapped = (
                    {
                        "x": (h[0] * x + h[1] * y + h[2]) / w,
                        "y": (h[3] * x + h[4] * y + h[5]) / w,
                    }
                    if w
                    else None
                )
                valid = (
                    abs(w) > 1e-12
                    and mapped is not None
                    and all(math.isfinite(n) for n in mapped.values())
                )
                label = _stamp(t)
                samples.append(
                    {
                        **self._base(
                            f"pupil-pog-{topic}-{label}",
                            t,
                            eye,
                            "pog2d",
                            _confidence(record.get("confidence")),
                            valid,
                            context,
                            {
                                "mappingId": o["mappingId"],
                                "vendorTopic": topic,
                                "sceneToSurface": list(o["sceneToSurface"]),
                                "scenePoint": [p["x"], p["y"]],
                            },
                        ),
                        "space": "normalized-viewport",
                        **({"point": mapped} if valid else {}),
                    }
                )
        for key in staged_keys:
            self._seen[key] = True
            if len(self._seen) > 4096:
                self._seen.popitem(last=False)
        return {"samples": samples, "warnings": warnings}

    def adapt_surface(
        self, record: Mapping[str, Any], context: Mapping[str, Any] | None = None
    ) -> dict[str, Any]:
        o = self._options
        if not o.get("surfaceName"):
            raise ValueError("Declare surfaceName before consuming Pupil surface data")
        if record.get("name") != o["surfaceName"]:
            return {
                "samples": [],
                "warnings": [self._warning("SURFACE_REGISTRATION_REQUIRED")],
            }
        mapping_time = timestamp_to_milliseconds(record.get("timestamp"), "s")
        samples, warnings = [], []
        for data in record.get("gaze_on_surfaces", []):
            t = timestamp_to_milliseconds(data.get("timestamp"), "s")
            topic = str(data.get("topic", ""))
            p = _coordinates(data.get("norm_pos"))
            eye = (
                "combined"
                if ".01." in topic
                else "right"
                if ".0." in topic
                else "left"
                if ".1." in topic
                else "unknown"
            )
            if eye not in self._source["eyes"]:
                continue
            skew = abs(t - mapping_time)
            valid = p is not None and skew <= o.get("maxMappingSkewMs", 50)
            label = _stamp(t)
            samples.append(
                {
                    **self._base(
                        f"pupil-surface-{topic}-{label}",
                        t,
                        eye,
                        "pog2d",
                        _confidence(data.get("confidence")),
                        valid,
                        context,
                        {
                            "surfaceName": o["surfaceName"],
                            "mappingTimeMs": mapping_time,
                            "mappingSkewMs": skew,
                            "vendorTopic": topic,
                        },
                    ),
                    "space": "normalized-viewport",
                    **(
                        {"point": {"x": p["x"], "y": 1 - p["y"]}}
                        if p is not None
                        else {}
                    ),
                }
            )
            if skew > o.get("maxMappingSkewMs", 50):
                warnings.append(self._warning("GEOMETRY_UNAVAILABLE", eye))
        return {"samples": samples, "warnings": warnings}
