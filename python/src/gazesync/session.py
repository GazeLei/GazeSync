"""Capture-time joins, source/eye identity, recording and deterministic replay."""

from __future__ import annotations
import copy
import math
from collections import OrderedDict, deque
from types import MappingProxyType
from typing import Any, Callable, Mapping
from .clocks import ClockRegistry
from .diagnostics import Diagnostics
from .geometry import (
    apply_affine,
    finite,
    invert_affine,
    point,
    positive,
    project_ray,
    validate_matrix,
    validate_plane,
    vector,
    view_matrix,
)
from .records import json_record
from .version import IMPLEMENTATION_VERSION, SCHEMA_VERSION

EYES = ("left", "right", "combined", "unknown")


def _observation_key(sample):
    return tuple(
        sample[k] for k in ("sourceId", "clockId", "clockEpoch", "eye", "type", "id")
    )


def _inside(p, width, height):
    if not all(math.isfinite(n) for n in (p["x"], p["y"], width, height)):
        return False
    tolerance = 64 * math.ulp(1.0) * max(1, width, height, abs(p["x"]), abs(p["y"]))
    return (
        -tolerance <= p["x"] <= width + tolerance
        and -tolerance <= p["y"] <= height + tolerance
    )


def _geometry_key(frame: dict[str, Any], kind: str) -> list[Any]:
    v, s = frame["view"], frame["surface"]
    d, p = s.get("display"), s.get("plane")
    return [
        frame["matrix"],
        frame["contentId"],
        v["width"],
        v["height"],
        v["contentWidth"],
        v["contentHeight"],
        s["id"],
        s["epoch"],
        s.get("active", True),
        [d[k] for k in ("width", "height", "left", "top")] if d else None,
        [
            p["frameId"],
            p["topLeft"],
            p["right"],
            p["down"],
            p["widthMeters"],
            p["heightMeters"],
            p.get("static", False),
            s.get("planeSpace", "viewport"),
        ]
        if kind == "ray3d" and p
        else None,
    ]


def _validate_surface(surface: Mapping[str, Any], view: Mapping[str, Any]) -> None:
    for key in ("id", "epoch"):
        if not isinstance(surface.get(key), str) or not surface[key]:
            raise ValueError("Surface id and epoch are required strings")
    if "active" in surface and not isinstance(surface["active"], bool):
        raise ValueError("surface.active must be boolean")
    for key in ("devicePixelRatio", "expectedPresentationHz"):
        if key in surface:
            positive(surface[key], key)
    if "presentationMode" in surface and surface["presentationMode"] not in (
        "per-frame",
        "change-only",
    ):
        raise ValueError("Unknown presentationMode")
    if surface.get("display"):
        for key in ("width", "height"):
            positive(surface["display"].get(key), "display." + key)
        for key in ("left", "top"):
            finite(surface["display"].get(key), "display." + key)
    if "planeSpace" in surface and surface["planeSpace"] not in ("viewport", "display"):
        raise ValueError("planeSpace must be viewport or display")
    if surface.get("planeSpace") == "display" and not surface.get("display"):
        raise ValueError("planeSpace display requires the full display layout")
    if surface.get("plane"):
        d = surface.get("display")
        if (
            "planeSpace" not in surface
            and d
            and (
                d["left"] != 0
                or d["top"] != 0
                or d["width"] != view["width"]
                or d["height"] != view["height"]
            )
        ):
            raise ValueError(
                "Declare planeSpace explicitly when the viewport differs from the full display"
            )
        validate_plane(surface["plane"])
        if surface["plane"].get("static") is not True:
            finite(surface.get("poseTimeMs"), "dynamic plane poseTimeMs")
    for key in ("width", "height", "contentWidth", "contentHeight"):
        positive(view.get(key), key)


def _validate_gaze(sample: Mapping[str, Any]) -> None:
    for key in ("id", "sourceId", "clockId", "clockEpoch", "surfaceId", "surfaceEpoch"):
        if not isinstance(sample.get(key), str) or not sample[key]:
            raise ValueError(f"Gaze {key} is required")
    finite(sample.get("timeMs"), "gaze source time")
    for key in ("captureId", "calibrationId"):
        if key in sample and (not isinstance(sample[key], str) or not sample[key]):
            raise ValueError(f"{key} must be a nonempty string")
    if "confidence" not in sample:
        raise ValueError("confidence must be explicit (number or null)")
    if sample["confidence"] is not None:
        finite(sample["confidence"], "confidence")
        if not 0 <= sample["confidence"] <= 1:
            raise ValueError("Confidence must be in [0,1]")
    if not isinstance(sample.get("valid"), bool):
        raise ValueError("Gaze valid must be explicit")
    if "blink" in sample and not isinstance(sample["blink"], bool):
        raise ValueError("Gaze blink must be boolean")
    if sample.get("type") not in ("pog2d", "ray3d", "direction3d"):
        raise ValueError("Unknown gaze type")
    if sample.get("eye") not in EYES:
        raise ValueError("Explicit eye identity is required")
    if "point" in sample:
        point(sample["point"])
    if "ray" in sample:
        vector(sample["ray"].get("origin"), "ray.origin")
        vector(sample["ray"].get("direction"), "ray.direction")
    if not sample["valid"] or sample.get("blink"):
        return
    if sample["type"] == "pog2d":
        point(sample.get("point"))
        if sample.get("space") not in (
            "viewport",
            "normalized-viewport",
            "normalized-display",
        ):
            raise ValueError("Unknown PoG coordinate space")
    elif sample["type"] == "ray3d":
        ray = sample.get("ray", {})
        vector(ray.get("origin"), "ray.origin")
        vector(ray.get("direction"), "ray.direction")
        if not isinstance(ray.get("frameId"), str) or not ray["frameId"]:
            raise ValueError("Ray frameId is required")
    else:
        vector(sample.get("direction"), "direction")
        if not isinstance(sample.get("frameId"), str) or not sample["frameId"]:
            raise ValueError("frameId is required")


class GazeSession:
    """Not thread-safe: serialize SDK callbacks/presentation logging in the host."""

    def __init__(
        self,
        config: Mapping[str, Any] | None = None,
        *,
        on_diagnostic: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        defaults = {
            "reorderWindowMs": 60,
            "maxClockUncertaintyMs": 8,
            "minConfidence": 0.6,
            "maxPoseAgeMs": 50,
            "maxLatencyMs": 250,
            "maxFrames": 7200,
            "maxRecords": 100000,
            "maxPending": 4096,
        }
        config = {} if config is None else config
        for key in config:
            if key not in defaults:
                raise ValueError(f"Unknown session option: {key}")
        settings = {**defaults, **config}
        for key, n in settings.items():
            finite(n, key)
            if n < 0:
                raise ValueError(f"{key} cannot be negative")
        if settings["minConfidence"] > 1:
            raise ValueError("minConfidence must be in [0,1]")
        for key in ("maxFrames", "maxRecords", "maxPending"):
            if not float(settings[key]).is_integer() or settings[key] < 2:
                raise ValueError(f"{key} must be an integer >= 2")
        self.config = MappingProxyType(settings)
        self.clocks = ClockRegistry()
        self.diagnostics = Diagnostics(on_diagnostic)
        self._frames: list[dict[str, Any]] = []
        self._surface_frames: dict[str, list[dict[str, Any]]] = {}
        self._pending: list[dict[str, Any]] = []
        self._records: deque[dict[str, Any]] = deque()
        self._aligned: list[dict[str, Any]] = []
        self._sources: dict[str, dict[str, Any]] = {}
        self._seen_sources: set[str] = set()
        self._seen_samples: OrderedDict[Any, bool] = OrderedDict()
        self._pending_keys: set[tuple] = set()
        self.records_dropped = self.aligned_dropped = self._frame_sequence = (
            self._record_sequence
        ) = 0
        self._last_flush = self._finalized_through = -float("inf")

    @property
    def frames(self) -> list[dict[str, Any]]:
        return copy.deepcopy(self._frames)

    @property
    def pending(self) -> list[dict[str, Any]]:
        return copy.deepcopy(self._pending)

    @property
    def aligned(self) -> list[dict[str, Any]]:
        return copy.deepcopy(self._aligned)

    @property
    def records(self) -> list[dict[str, Any]]:
        return copy.deepcopy(list(self._records))

    def register_source(self, source: Mapping[str, Any]) -> dict[str, Any]:
        if any(
            not isinstance(source.get(k), str) or not source[k]
            for k in ("id", "adapter")
        ):
            raise ValueError("Source id and adapter are required")
        if source.get("kind") not in ("model", "tracker", "simulated", "custom"):
            raise ValueError("Unknown source kind")
        if source.get("trackingMode") not in (
            "monocular",
            "binocular-independent",
            "binocular-fused",
            "mixed",
            "unspecified",
        ):
            raise ValueError("Unknown trackingMode")
        if (
            not isinstance(source.get("eyes"), list)
            or not source["eyes"]
            or len(set(source["eyes"])) != len(source["eyes"])
            or any(e not in EYES for e in source["eyes"])
        ):
            raise ValueError("Source eyes are required")
        if "timestampKind" in source and source["timestampKind"] not in (
            "exposure",
            "vendor-estimate",
            "host-receipt",
        ):
            raise ValueError("Unknown timestampKind")
        if "hardwareValidated" in source and not isinstance(
            source["hardwareValidated"], bool
        ):
            raise ValueError("hardwareValidated must be boolean")
        if "expectedHz" in source:
            positive(source["expectedHz"], "expectedHz")
        for eye, hz in source.get("eyeRatesHz", {}).items():
            if eye not in source["eyes"]:
                raise ValueError("eyeRatesHz must describe declared eyes")
            positive(hz, "eyeRatesHz")
        existing = self._sources.get(source["id"])
        if existing is not None and existing != source:
            raise ValueError("Source descriptor is immutable; use a new source ID")
        if existing is None and source["id"] in self._seen_sources:
            raise ValueError("Register source metadata before its first sample")
        value = json_record(dict(source))
        self._sources[source["id"]] = value
        return copy.deepcopy(value)

    def _record(self, kind: str, payload: dict[str, Any]) -> None:
        self._record_sequence += 1
        self._records.append(
            {
                "sequence": self._record_sequence,
                "type": kind,
                "payload": copy.deepcopy(payload),
            }
        )
        if len(self._records) > self.config["maxRecords"]:
            self._records.popleft()
            self.records_dropped += 1
            self.diagnostics.emit(
                "RECORDING_TRUNCATED",
                self._last_flush if math.isfinite(self._last_flush) else 0,
            )

    def input(self, event: Mapping[str, Any]) -> None:
        finite(event.get("t"), "input time")
        for key in ("id", "kind"):
            if not isinstance(event.get(key), str) or not event[key]:
                raise ValueError(f"Input {key} must be a nonempty string")
        self._record("input", json_record(dict(event)))

    def present(
        self,
        *,
        t: float,
        view: Mapping[str, Any],
        surface: Mapping[str, Any],
        contentId: str = "content",
        matrix: list[float] | None = None,
        causeIds: list[str] | None = None,
        timing: str = "render-callback",
    ) -> dict[str, Any]:
        finite(t, "presentation time")
        if t <= self._last_flush:
            raise ValueError("Presentation is behind the finalized watermark")
        if self._frames and t < self._frames[-1]["t"]:
            raise ValueError("Presentation time regressed")
        matrix = view_matrix(view) if matrix is None else matrix
        causeIds = [] if causeIds is None else causeIds
        validate_matrix(matrix)
        _validate_surface(surface, view)
        if not isinstance(causeIds, list) or any(
            not isinstance(i, str) or not i for i in causeIds
        ):
            raise ValueError("causeIds must be an array of nonempty strings")
        if not isinstance(contentId, str) or not contentId:
            raise ValueError("contentId must be a nonempty string")
        if timing not in ("render-callback", "display-feedback", "synthetic"):
            raise ValueError("Unknown presentation timing quality")
        if (
            surface["id"] not in self._surface_frames
            and len(self._surface_frames) >= self.config["maxFrames"]
        ):
            raise ValueError(
                "maxFrames cannot retain another surface; increase the budget or use another session"
            )
        inverse = invert_affine(matrix)
        payload = json_record(
            {
                "id": f"frame-{self._frame_sequence + 1}",
                "t": t,
                "view": dict(view),
                "surface": dict(surface),
                "contentId": contentId,
                "matrix": matrix,
                "causeIds": causeIds,
                "timing": timing,
            }
        )
        frame = {
            **copy.deepcopy(payload),
            "inverseMatrix": inverse,
            "geometryKeys": {
                kind: _geometry_key(payload, kind)
                for kind in ("pog2d", "ray3d", "direction3d")
            },
        }
        self._frame_sequence += 1
        self._frames.append(frame)
        self._surface_frames.setdefault(surface["id"], []).append(frame)
        if len(self._frames) > self.config["maxFrames"]:
            index = next(
                i
                for i, f in enumerate(self._frames)
                if len(self._surface_frames[f["surface"]["id"]]) > 1
            )
            removed = self._frames.pop(index)
            self._surface_frames[removed["surface"]["id"]].pop(0)
        self._record("frame", payload)
        self.diagnostics.presentation(payload)
        return copy.deepcopy(payload)

    def gaze(self, sample: Mapping[str, Any], received_time_ms: float) -> None:
        _validate_gaze(sample)
        finite(received_time_ms, "received time")
        if len(self._pending) >= self.config["maxPending"]:
            raise ValueError(
                "Gaze reorder buffer full; flush or apply source backpressure"
            )
        mapped = self.clocks.map(
            sample["clockId"], sample["clockEpoch"], sample["timeMs"]
        )
        key = _observation_key(sample)
        if key in self._seen_samples or key in self._pending_keys:
            raise ValueError(f"Duplicate gaze sample: {sample['id']}")
        raw = json_record(dict(sample))
        self._seen_samples[key] = True
        if len(self._seen_samples) > self.config["maxRecords"]:
            self._seen_samples.popitem(last=False)
        item = {
            "sample": raw,
            "receivedTimeMs": received_time_ms,
            "captureTimeMs": mapped["timeMs"],
            "uncertaintyMs": mapped["uncertaintyMs"],
            "late": mapped["timeMs"] <= self._finalized_through,
            "sequence": self._record_sequence + 1,
            "quarantined": mapped["timeMs"] > received_time_ms + mapped["uncertaintyMs"]
            or mapped["uncertaintyMs"] > self.config["maxClockUncertaintyMs"],
        }
        self._pending.append(item)
        self._pending_keys.add(key)
        self._record("gaze", {"sample": raw, "receivedTimeMs": received_time_ms})
        self._seen_sources.add(sample["sourceId"])
        if not item["quarantined"]:
            self.diagnostics.gaze(
                raw, mapped["timeMs"], self._sources.get(sample["sourceId"])
            )

    def _frame_index_at(self, t: float, surface_id: str | None = None) -> int:
        history = (
            self._frames
            if surface_id is None
            else self._surface_frames.get(surface_id, [])
        )
        lo, hi = 0, len(history)
        while lo < hi:
            mid = (lo + hi) // 2
            if history[mid]["t"] <= t:
                lo = mid + 1
            else:
                hi = mid
        return lo - 1

    def _frame_at(
        self, t: float, surface_id: str | None = None
    ) -> dict[str, Any] | None:
        history = (
            self._frames
            if surface_id is None
            else self._surface_frames.get(surface_id, [])
        )
        index = self._frame_index_at(t, surface_id)
        return history[index] if index >= 0 else None

    def frame_at(
        self, t: float, surface_id: str | None = None
    ) -> dict[str, Any] | None:
        return copy.deepcopy(self._frame_at(t, surface_id))

    def _align(self, item: dict[str, Any], horizon: float) -> dict[str, Any]:
        s, t, received, uncertainty = (
            item["sample"],
            item["captureTimeMs"],
            item["receivedTimeMs"],
            item["uncertaintyMs"],
        )
        flags = []
        if item["late"]:
            flags.append("late-arrival")
        if not s["valid"]:
            flags.append("invalid-measurement")
        if s.get("blink"):
            flags.append("blink")
        if self._sources.get(s["sourceId"], {}).get("timestampKind") == "host-receipt":
            flags.append("receipt-time-only")
        if s["confidence"] is None:
            flags.append("confidence-unavailable")
        elif s["confidence"] < self.config["minConfidence"]:
            flags.append("low-confidence")
        if uncertainty > self.config["maxClockUncertaintyMs"]:
            flags.append("clock-uncertain")
        if t + uncertainty > horizon:
            flags.append("incomplete-uncertainty-window")
        if t > received + uncertainty:
            flags.append("future-capture")
        if received - t > self.config["maxLatencyMs"]:
            flags.append("high-latency")
        f = None if t > horizon else self._frame_at(t, s["surfaceId"])
        result = {
            "eye": s["eye"],
            "clockId": s["clockId"],
            "clockEpoch": s["clockEpoch"],
            **({"calibrationId": s["calibrationId"]} if "calibrationId" in s else {}),
            **({"captureId": s["captureId"]} if "captureId" in s else {}),
            "sampleId": s["id"],
            "sourceId": s["sourceId"],
            "type": s["type"],
            "captureTimeMs": t,
            "receivedTimeMs": received,
            "latencyMs": received - t,
            "clockUncertaintyMs": uncertainty,
            "frameId": f["id"] if f else None,
            "surfaceId": s["surfaceId"],
            "surfaceEpoch": s["surfaceEpoch"],
            "viewportPoint": None,
            "contentPoint": None,
            "rayHit": None,
            "usable": False,
            "flags": flags,
        }
        if f is None:
            flags.append("missing-history")
            return result
        result.update(
            presentationTimeMs=f["t"],
            contentId=f["contentId"],
            presentationTiming=f["timing"],
            causeIds=list(f["causeIds"]),
        )
        if f["surface"]["id"] != s["surfaceId"]:
            flags.append("surface-id-mismatch")
        if f["surface"]["epoch"] != s["surfaceEpoch"]:
            flags.append("surface-epoch-mismatch")
        if f["surface"].get("active") is False:
            flags.append("surface-inactive")
        if uncertainty > 0:
            history = self._surface_frames.get(s["surfaceId"], [])
            lower, upper = (
                self._frame_index_at(t - uncertainty, s["surfaceId"]),
                self._frame_index_at(t + uncertainty, s["surfaceId"]),
            )
            changed = lower < 0
            if not changed:
                changed = any(
                    history[i]["geometryKeys"][s["type"]]
                    != history[lower]["geometryKeys"][s["type"]]
                    for i in range(lower + 1, upper + 1)
                )
            if changed:
                flags.append("ambiguous-presentation")
        if (
            not s["valid"]
            or s.get("blink")
            or "surface-id-mismatch" in flags
            or "surface-epoch-mismatch" in flags
        ):
            return result
        p = None
        if s["type"] == "pog2d":
            if s["space"] == "viewport":
                p = dict(s["point"])
            elif s["space"] == "normalized-viewport":
                p = {
                    "x": s["point"]["x"] * f["view"]["width"],
                    "y": s["point"]["y"] * f["view"]["height"],
                }
            elif f["surface"].get("display"):
                d = f["surface"]["display"]
                p = {
                    "x": s["point"]["x"] * d["width"] - d["left"],
                    "y": s["point"]["y"] * d["height"] - d["top"],
                }
            else:
                flags.append("missing-display-layout")
        elif s["type"] == "direction3d":
            flags.append("direction-only")
            return result
        else:
            if (
                f["surface"].get("plane")
                and f["surface"]["plane"].get("static") is not True
            ):
                age = t - f["surface"]["poseTimeMs"]
                if age < -uncertainty:
                    flags.append("pose-after-capture")
                if age > self.config["maxPoseAgeMs"]:
                    flags.append("stale-plane-pose")
            layout = (
                f["surface"].get("display")
                if f["surface"].get("planeSpace") == "display"
                else None
            )
            hit = project_ray(
                s["ray"],
                f["surface"].get("plane"),
                layout["width"] if layout else f["view"]["width"],
                layout["height"] if layout else f["view"]["height"],
            )
            if "reason" in hit:
                flags.append(hit["reason"])
            else:
                hp = hit["point"]
                p = (
                    {"x": hp["x"] - layout["left"], "y": hp["y"] - layout["top"]}
                    if layout
                    else hp
                )
                result["rayHit"] = {
                    "frameId": f["surface"]["plane"]["frameId"],
                    "pointMeters": hit["hit"],
                    "distanceMeters": hit["distanceMeters"],
                }
        if p is None:
            return result
        try:
            point(p)
            content_point = apply_affine(f["inverseMatrix"], p)
        except (ValueError, OverflowError):
            flags.append("non-finite-projection")
            return result
        display = f["surface"].get("display")
        if display and not _inside(
            {"x": p["x"] + display["left"], "y": p["y"] + display["top"]},
            display["width"],
            display["height"],
        ):
            flags.append("off-display")
        result["viewportPoint"], result["contentPoint"] = p, content_point
        if not _inside(p, f["view"]["width"], f["view"]["height"]):
            flags.append("off-viewport")
        if not _inside(
            content_point, f["view"]["contentWidth"], f["view"]["contentHeight"]
        ):
            flags.append("off-content")
        result["usable"] = all(
            flag in ("late-arrival", "high-latency", "confidence-unavailable")
            for flag in flags
        )
        return result

    def flush(self, now: float, *, final: bool = False) -> list[dict[str, Any]]:
        finite(now, "flush time")
        if not isinstance(final, bool):
            raise ValueError("final must be boolean")
        if now < self._last_flush:
            raise ValueError("Flush time regressed")
        cutoff = now - (
            0
            if final
            else max(
                self.config["reorderWindowMs"], self.config["maxClockUncertaintyMs"]
            )
        )
        ready = sorted(
            (
                p
                for p in self._pending
                if (p["quarantined"] or p["captureTimeMs"] <= cutoff)
                and p["receivedTimeMs"] <= now
            ),
            key=lambda p: (p["captureTimeMs"], p["sequence"]),
        )
        results = [{**self._align(p, now), "alignedTimeMs": now} for p in ready]
        selected = {id(p) for p in ready}
        self._pending = [p for p in self._pending if id(p) not in selected]
        self._pending_keys.difference_update(
            _observation_key(p["sample"]) for p in ready
        )
        self._last_flush = now
        self._aligned.extend(results)
        for a in results:
            self.diagnostics.aligned(
                a["flags"], a["captureTimeMs"], a["sourceId"], a["eye"], a["surfaceId"]
            )
        if len(self._aligned) > self.config["maxRecords"]:
            count = len(self._aligned) - self.config["maxRecords"]
            del self._aligned[:count]
            self.aligned_dropped += count
        self._finalized_through = max(self._finalized_through, cutoff)
        self._record("flush", {"now": now, "final": final})
        return copy.deepcopy(results)

    def export(self) -> dict[str, Any]:
        return copy.deepcopy(
            {
                "schemaVersion": SCHEMA_VERSION,
                "implementationVersion": IMPLEMENTATION_VERSION,
                "recordCount": self._record_sequence,
                "config": dict(self.config),
                "clocks": self.clocks.export(),
                "sources": list(self._sources.values()),
                "diagnostics": self.diagnostics.report(),
                "recordsDropped": self.records_dropped,
                "alignedDropped": self.aligned_dropped,
                "pendingCount": len(self._pending),
                "records": list(self._records),
                "aligned": self._aligned,
            }
        )


def replay(recording: Mapping[str, Any]) -> GazeSession:
    if (
        recording.get("schemaVersion") != SCHEMA_VERSION
        or recording.get("implementationVersion") != IMPLEMENTATION_VERSION
    ):
        raise ValueError(
            "Unsupported recording schema or implementation version; exact replay requires the original version"
        )
    if recording.get("recordsDropped"):
        raise ValueError(
            "Recording was truncated; persist raw chunks before buffer rollover"
        )
    if not isinstance(recording.get("records"), list) or recording.get(
        "recordCount"
    ) != len(recording["records"]):
        raise ValueError("Recording is not complete: record count differs")
    if any(
        record.get("sequence") != i + 1 for i, record in enumerate(recording["records"])
    ):
        raise ValueError("Recording sequence is not complete or ordered")
    session = GazeSession(recording["config"])
    for source in recording["sources"]:
        session.register_source(source)
    for clock in recording["clocks"]:
        session.clocks.register(clock)
    for record in recording["records"]:
        payload = record["payload"]
        if record["type"] == "frame":
            session.present(**{k: v for k, v in payload.items() if k != "id"})
        elif record["type"] == "input":
            session.input(payload)
        elif record["type"] == "gaze":
            session.gaze(payload["sample"], payload["receivedTimeMs"])
        elif record["type"] == "flush":
            session.flush(payload["now"], final=payload["final"])
        else:
            raise ValueError(f"Unsupported recording record: {record['type']}")
    return session
