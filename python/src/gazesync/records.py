"""Validate finite, portable JSON data before mutating a capture session."""

from __future__ import annotations
import math
from typing import Any


def json_record(
    value: Any, path: str = "record", seen: set[int] | None = None, depth: int = 0
) -> Any:
    seen = set() if seen is None else seen
    if depth > 64:
        raise ValueError(f"{path}: JSON nesting exceeds 64 levels")
    if value is None or isinstance(value, (str, bool)):
        return value
    if isinstance(value, (int, float)):
        if not math.isfinite(value):
            raise ValueError(f"{path}: value must be finite JSON data")
        return value
    if type(value) not in (dict, list, tuple):
        raise TypeError(f"{path}: JSON objects must be plain data objects")
    if id(value) in seen:
        raise ValueError(f"{path}: cyclic JSON data")
    seen.add(id(value))
    if isinstance(value, dict):
        if any(not isinstance(k, str) for k in value):
            raise TypeError(f"{path}: JSON keys must be strings")
        result = {
            k: json_record(v, f"{path}.{k}", seen, depth + 1) for k, v in value.items()
        }
    else:
        result = [
            json_record(v, f"{path}[{i}]", seen, depth + 1) for i, v in enumerate(value)
        ]
    seen.remove(id(value))
    return result
