"""Explicit offline pairing of independent eyes; measurements are never averaged."""

from __future__ import annotations
import copy
from typing import Any, Iterable, Mapping
from .geometry import finite


def pair_eyes(
    samples: Iterable[Mapping[str, Any]], *, max_skew_ms: float = 5
) -> list[dict[str, Any]]:
    finite(max_skew_ms, "maxSkewMs")
    if max_skew_ms < 0:
        raise ValueError("maxSkewMs cannot be negative")
    groups: dict[Any, dict[str, list[Any]]] = {}
    for sample in samples:
        if not sample["usable"] or sample["eye"] not in ("left", "right"):
            continue
        key = tuple(
            sample.get(k)
            for k in (
                "sourceId",
                "type",
                "clockId",
                "clockEpoch",
                "surfaceId",
                "surfaceEpoch",
                "contentId",
                "calibrationId",
            )
        )
        groups.setdefault(key, {"left": [], "right": []})[sample["eye"]].append(sample)
    result = []
    for group in groups.values():
        lefts, rights = (
            sorted(group[eye], key=lambda s: s["captureTimeMs"])
            for eye in ("left", "right")
        )
        l = r = 0
        while l < len(lefts) or r < len(rights):
            left, right = (
                lefts[l] if l < len(lefts) else None,
                rights[r] if r < len(rights) else None,
            )
            if (
                left
                and right
                and abs(left["captureTimeMs"] - right["captureTimeMs"]) <= max_skew_ms
            ):
                result.append(
                    {
                        "left": left,
                        "right": right,
                        "skewMs": right["captureTimeMs"] - left["captureTimeMs"],
                    }
                )
                l += 1
                r += 1
            elif left and (not right or left["captureTimeMs"] < right["captureTimeMs"]):
                result.append({"left": left, "right": None, "skewMs": None})
                l += 1
            else:
                result.append({"left": None, "right": right, "skewMs": None})
                r += 1
    result.sort(key=lambda pair: (pair["left"] or pair["right"])["captureTimeMs"])
    return copy.deepcopy(result)
