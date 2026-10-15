"""Structured, aggregated diagnostics. No warning is sent to an external service."""

from __future__ import annotations
import bisect
import copy
import json
import logging
from importlib.resources import files
from typing import Any, Callable

DIAGNOSTIC_CATALOG: dict[str, dict[str, str]] = json.loads(
    files(__package__).joinpath("diagnostics_catalog.json").read_text()
)


def logging_observer(
    logger: logging.Logger | None = None,
) -> Callable[[dict[str, Any]], None]:
    logger = logging.getLogger("gazesync") if logger is None else logger

    def observe(event: dict[str, Any]) -> None:
        level = {
            "info": logging.INFO,
            "warning": logging.WARNING,
            "error": logging.ERROR,
        }[event["severity"]]
        logger.log(level, "%s: %s %s", event["code"], event["message"], event["remedy"])

    return observe


class Diagnostics:
    def __init__(
        self, on_diagnostic: Callable[[dict[str, Any]], None] | None = None
    ) -> None:
        self._issues: dict[Any, dict[str, Any]] = {}
        self._streams: dict[Any, dict[str, Any]] = {}
        self._surfaces: dict[Any, float] = {}
        self._observer = on_diagnostic

    def emit(
        self, code: str, time_ms: float, context: dict[str, Any] | None = None
    ) -> None:
        context = {} if context is None else context
        entry = DIAGNOSTIC_CATALOG[code]
        key = (
            code,
            context.get("sourceId"),
            context.get("eye"),
            context.get("surfaceId"),
        )
        if key in self._issues:
            self._issues[key]["count"] += 1
            self._issues[key]["lastTimeMs"] = max(
                self._issues[key]["lastTimeMs"], time_ms
            )
            return
        event = {"code": code, **entry, "timeMs": time_ms, **context}
        self._issues[key] = {**event, "count": 1, "lastTimeMs": time_ms}
        if self._observer is not None:
            try:
                self._observer(copy.deepcopy(event))
            except Exception:
                self._issues["callback-failed"] = {
                    "code": "CALLBACK_FAILED",
                    **DIAGNOSTIC_CATALOG["CALLBACK_FAILED"],
                    "timeMs": time_ms,
                    "count": 1,
                    "lastTimeMs": time_ms,
                }

    def gaze(
        self,
        sample: dict[str, Any],
        capture_time_ms: float,
        source: dict[str, Any] | None = None,
    ) -> None:
        context = {"sourceId": sample["sourceId"], "eye": sample["eye"]}
        if source is None:
            self.emit("SOURCE_UNREGISTERED", capture_time_ms, context)
        if sample["eye"] == "unknown":
            self.emit("EYE_UNSPECIFIED", capture_time_ms, context)
        if sample["confidence"] is None:
            self.emit("CONFIDENCE_UNAVAILABLE", capture_time_ms, context)
        if (
            source
            and source.get("timestampKind")
            and source["timestampKind"] != "exposure"
        ):
            self.emit("VENDOR_TIMESTAMP_ESTIMATE", capture_time_ms, context)
        key = tuple(
            sample[k] for k in ("sourceId", "eye", "type", "clockId", "clockEpoch")
        )
        stream = self._streams.get(key)
        if stream is None:
            stream = {
                "rate": {
                    "sourceId": sample["sourceId"],
                    "eye": sample["eye"],
                    "type": sample["type"],
                    "clockId": sample["clockId"],
                    "clockEpoch": sample["clockEpoch"],
                    "observedHz": None,
                    "samples": 0,
                },
                "times": [],
                "newest": capture_time_ms,
                "expected": source.get("eyeRatesHz", {}).get(
                    sample["eye"], source.get("expectedHz")
                )
                if source
                else None,
                "lastRateNotice": -float("inf"),
            }
            self._streams[key] = stream
        else:
            delta = capture_time_ms - stream["newest"]
            if delta < 0:
                self.emit("OUT_OF_ORDER", capture_time_ms, context)
            if stream["expected"] and delta > 3 * 1000 / stream["expected"]:
                self.emit("SOURCE_GAP", capture_time_ms, context)
            stream["newest"] = max(stream["newest"], capture_time_ms)
        stream["rate"]["samples"] += 1
        times = stream["times"]
        index = bisect.bisect_left(times, capture_time_ms)
        if index == len(times) or times[index] != capture_time_ms:
            times.insert(index, capture_time_ms)
        while len(times) > 2048 or (
            len(times) > 2 and times[0] < stream["newest"] - 2000
        ):
            times.pop(0)
        span = times[-1] - times[0]
        stream["rate"]["observedHz"] = (
            (len(times) - 1) * 1000 / span if span > 0 else None
        )
        min_span = (
            min(1000, 1800 * 1000 / stream["expected"]) if stream["expected"] else 1000
        )
        if (
            stream["expected"]
            and len(times) >= 5
            and span >= min_span
            and capture_time_ms - stream["lastRateNotice"] >= 1000
        ):
            stream["lastRateNotice"] = capture_time_ms
            if abs(stream["rate"]["observedHz"] / stream["expected"] - 1) > 0.2:
                self.emit("SOURCE_RATE_DEVIATION", capture_time_ms, context)

    def presentation(self, frame: dict[str, Any]) -> None:
        surface = frame["surface"]
        key = (surface["id"], surface["epoch"])
        prior, expected = self._surfaces.get(key), surface.get("expectedPresentationHz")
        if (
            prior is not None
            and expected
            and surface.get("presentationMode") == "per-frame"
            and frame["t"] - prior > 2.5 * 1000 / expected
        ):
            self.emit("PRESENTATION_GAP", frame["t"], {"surfaceId": surface["id"]})
        self._surfaces[key] = frame["t"]

    def aligned(
        self,
        flags: list[str],
        time_ms: float,
        source_id: str,
        eye: str,
        surface_id: str,
    ) -> None:
        mapping = {
            "missing-history": "HISTORY_EXPIRED",
            "clock-uncertain": "CLOCK_UNCERTAIN",
            "future-capture": "FUTURE_CAPTURE",
            "surface-epoch-mismatch": "SURFACE_MISMATCH",
            "missing-plane": "GEOMETRY_UNAVAILABLE",
            "coordinate-frame-mismatch": "GEOMETRY_UNAVAILABLE",
            "direction-only": "GEOMETRY_UNAVAILABLE",
            "stale-plane-pose": "GEOMETRY_UNAVAILABLE",
            "pose-after-capture": "GEOMETRY_UNAVAILABLE",
            "missing-display-layout": "DISPLAY_LAYOUT_REQUIRED",
            "receipt-time-only": "EXPOSURE_TIME_REQUIRED",
        }
        for flag in flags:
            if flag in mapping:
                self.emit(
                    mapping[flag],
                    time_ms,
                    {"sourceId": source_id, "eye": eye, "surfaceId": surface_id},
                )

    def report(self) -> dict[str, Any]:
        return copy.deepcopy(
            {
                "issues": list(self._issues.values()),
                "streams": [s["rate"] for s in self._streams.values()],
            }
        )
