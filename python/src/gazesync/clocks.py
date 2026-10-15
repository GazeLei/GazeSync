"""Immutable affine source-clock mappings, in milliseconds."""

from __future__ import annotations
import copy
import sys
from typing import Any, Mapping
from .geometry import finite, positive


class ClockRegistry:
    def __init__(self) -> None:
        self._mappings: dict[tuple[str, str], dict[str, Any]] = {}
        self.register(
            {"id": "session", "epoch": "0", "sourceOriginMs": 0, "sessionOriginMs": 0}
        )

    def register(self, mapping: Mapping[str, Any]) -> dict[str, Any]:
        m = {
            "id": mapping.get("id"),
            "epoch": mapping.get("epoch"),
            "sourceOriginMs": mapping.get("sourceOriginMs"),
            "sessionOriginMs": mapping.get("sessionOriginMs"),
            "rate": mapping.get("rate", 1),
            "uncertaintyMs": mapping.get("uncertaintyMs", 0),
            "driftUncertaintyPpm": mapping.get("driftUncertaintyPpm", 0),
        }
        if any(not isinstance(m[k], str) or not m[k] for k in ("id", "epoch")):
            raise ValueError("Clock id and epoch are required strings")
        for key in (
            "sourceOriginMs",
            "sessionOriginMs",
            "uncertaintyMs",
            "driftUncertaintyPpm",
        ):
            finite(m[key], key)
        positive(m["rate"], "clock rate")
        if m["uncertaintyMs"] < 0 or m["driftUncertaintyPpm"] < 0:
            raise ValueError("Clock uncertainty cannot be negative")
        key = (m["id"], m["epoch"])
        if key in self._mappings and self._mappings[key] != m:
            raise ValueError("Clock epoch is immutable; register a new epoch")
        self._mappings[key] = m
        return copy.deepcopy(m)

    def map(self, clock_id: str, epoch: str, source_time_ms: float) -> dict[str, float]:
        finite(source_time_ms, "sourceTimeMs")
        if (clock_id, epoch) not in self._mappings:
            raise ValueError(f"Unregistered clock epoch: {clock_id}/{epoch}")
        m = self._mappings[clock_id, epoch]
        elapsed = (source_time_ms - m["sourceOriginMs"]) * m["rate"]
        identity = m["sourceOriginMs"] == m["sessionOriginMs"] and m["rate"] == 1
        roundoff = (
            0
            if identity
            else 4
            * sys.float_info.epsilon
            * max(
                1,
                abs(source_time_ms),
                abs(m["sourceOriginMs"]),
                abs(m["sessionOriginMs"]),
                abs(elapsed),
            )
        )
        time_ms = source_time_ms if identity else m["sessionOriginMs"] + elapsed
        uncertainty = (
            m["uncertaintyMs"]
            + abs(elapsed) * m["driftUncertaintyPpm"] / 1e6
            + roundoff
        )
        finite(time_ms, "mapped time")
        finite(uncertainty, "mapped uncertainty")
        return {"timeMs": time_ms, "uncertaintyMs": uncertainty}

    def export(self) -> list[dict[str, Any]]:
        return copy.deepcopy(list(self._mappings.values()))
