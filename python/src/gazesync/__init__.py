"""GazeSync: portable screen/gaze synchronization; no hardware SDK is bundled."""

from .version import SCHEMA_VERSION, IMPLEMENTATION_VERSION
from .clocks import ClockRegistry
from .controller import ZoomController
from .session import GazeSession, replay
from .diagnostics import Diagnostics, DIAGNOSTIC_CATALOG, logging_observer
from .binocular import pair_eyes
from .adapters import (
    ModelAdapter,
    TobiiProAdapter,
    EyeLinkAdapter,
    PupilCoreAdapter,
    timestamp_to_milliseconds,
)
from .geometry import (
    create_view,
    reset_view,
    resize_view,
    zoom_at,
    zoom_to_box,
    pan_by,
    zoom_level,
    content_to_viewport,
    viewport_to_content,
    view_matrix,
    apply_affine,
    invert_affine,
    project_ray,
    validate_rigid_transform,
    transform_point_3d,
    transform_direction_3d,
    transform_ray,
    transform_plane,
    invert_rigid_transform,
)

__version__ = IMPLEMENTATION_VERSION
__all__ = [
    "SCHEMA_VERSION",
    "IMPLEMENTATION_VERSION",
    "ClockRegistry",
    "ZoomController",
    "GazeSession",
    "replay",
    "Diagnostics",
    "DIAGNOSTIC_CATALOG",
    "logging_observer",
    "create_view",
    "reset_view",
    "resize_view",
    "zoom_at",
    "zoom_to_box",
    "pan_by",
    "zoom_level",
    "content_to_viewport",
    "viewport_to_content",
    "view_matrix",
    "apply_affine",
    "invert_affine",
    "project_ray",
    "validate_rigid_transform",
    "transform_point_3d",
    "transform_direction_3d",
    "transform_ray",
    "transform_plane",
    "invert_rigid_transform",
    "pair_eyes",
    "ModelAdapter",
    "TobiiProAdapter",
    "EyeLinkAdapter",
    "PupilCoreAdapter",
    "timestamp_to_milliseconds",
]
