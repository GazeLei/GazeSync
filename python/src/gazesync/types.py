"""Static wire-documentation types; runtime ingestion validates the full contract."""

from __future__ import annotations
from typing import Any, Literal, TypedDict, Union

Eye = Literal["left", "right", "combined", "unknown"]
TrackingMode = Literal[
    "monocular", "binocular-independent", "binocular-fused", "mixed", "unspecified"
]


class Point(TypedDict):
    x: float
    y: float


class Ray(TypedDict):
    frameId: str
    origin: list[float]
    direction: list[float]


class _OptionalGaze(TypedDict, total=False):
    captureId: str
    calibrationId: str
    blink: bool
    metadata: dict[str, Any]


class GazeBase(_OptionalGaze):
    id: str
    sourceId: str
    eye: Eye
    clockId: str
    clockEpoch: str
    timeMs: float
    surfaceId: str
    surfaceEpoch: str
    confidence: float | None
    valid: bool


class PoG2D(GazeBase, total=False):
    type: Literal["pog2d"]
    point: Point
    space: Literal["viewport", "normalized-viewport", "normalized-display"]


class GazeRay3D(GazeBase, total=False):
    type: Literal["ray3d"]
    ray: Ray


class GazeDirection3D(GazeBase, total=False):
    type: Literal["direction3d"]
    direction: list[float]
    frameId: str


GazeSample = Union[PoG2D, GazeRay3D, GazeDirection3D]


class _OptionalSource(TypedDict, total=False):
    expectedHz: float
    eyeRatesHz: dict[Eye, float]
    timestampKind: Literal["exposure", "vendor-estimate", "host-receipt"]
    deviceModel: str
    modelVersion: str
    calibrationId: str
    hardwareValidated: bool


class SourceDescriptor(_OptionalSource):
    id: str
    kind: Literal["model", "tracker", "simulated", "custom"]
    adapter: str
    eyes: list[Eye]
    trackingMode: TrackingMode


class _TransformOptions(TypedDict, total=False):
    static: bool


class RigidTransform(_TransformOptions):
    fromFrameId: str
    toFrameId: str
    rotation: list[float]  # Row-major proper rotation, nine entries.
    translation: list[float]  # Target-frame source origin in metres.
