"""Small offline CLI; never opens a hardware connection or uploads data."""

from __future__ import annotations
import argparse
import json
import math
from pathlib import Path
import sys
from .adapters import ModelAdapter, TobiiProAdapter, EyeLinkAdapter, PupilCoreAdapter
from .experiments import generate_experiment, execute_experiment, summarize_experiment
from .session import replay

GEOMETRY_ABS_TOLERANCE = 1e-8
GEOMETRY_REL_TOLERANCE = 1e-12


def _same_value(actual, expected, approximate=False):
    if isinstance(actual, bool) or isinstance(expected, bool):
        return type(actual) is type(expected) and actual == expected
    if isinstance(actual, (int, float)) or isinstance(expected, (int, float)):
        if not isinstance(actual, (int, float)) or not isinstance(
            expected, (int, float)
        ):
            return False
        try:
            if not math.isfinite(actual) or not math.isfinite(expected):
                return False
            tolerance = (
                GEOMETRY_ABS_TOLERANCE
                + GEOMETRY_REL_TOLERANCE * max(abs(actual), abs(expected))
                if approximate
                else 0
            )
            return abs(actual - expected) <= tolerance
        except OverflowError:
            return False
    if type(actual) is not type(expected):
        return False
    if isinstance(actual, dict):
        return actual.keys() == expected.keys() and all(
            _same_value(actual[key], expected[key], approximate) for key in actual
        )
    if isinstance(actual, list):
        return len(actual) == len(expected) and all(
            _same_value(a, b, approximate) for a, b in zip(actual, expected)
        )
    return actual == expected


def _cross_language_match(actual, expected):
    if not isinstance(expected, list) or len(actual) != len(expected):
        return False
    geometry = {"viewportPoint", "contentPoint", "rayHit"}
    return all(
        isinstance(b, dict)
        and a.keys() == b.keys()
        and all(_same_value(a[key], b[key], key in geometry) for key in a)
        for a, b in zip(actual, expected)
    )


def _read(path):
    # Decode JSON bytes independently of the host locale, including piped input.
    return (
        json.load(getattr(sys.stdin, "buffer", sys.stdin))
        if path == "-"
        else json.loads(Path(path).read_bytes())
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("replay")
    p.add_argument("file")
    p.add_argument("--full", action="store_true")
    p.add_argument(
        "--cross-language",
        action="store_true",
        help="allow small geometry differences while keeping timestamps, IDs and flags exact",
    )
    p = sub.add_parser("align-events")
    p.add_argument("file", nargs="?", default="-")
    p.add_argument("--aligned-only", action="store_true")
    p = sub.add_parser("normalize-fixtures")
    p.add_argument("file")
    p = sub.add_parser("simulate")
    p.add_argument("--width", type=float, default=1280)
    p.add_argument("--height", type=float, default=720)
    p.add_argument("--display-hz", type=float, default=60)
    p.add_argument("--input-hz", type=float, default=240)
    p.add_argument("--gaze-hz", type=float, default=120)
    p.add_argument("--right-gaze-hz", type=float)
    p.add_argument("--physical-width-m", type=float)
    p.add_argument("--physical-height-m", type=float)
    p.add_argument(
        "--mode",
        choices=[
            "monocular-left",
            "monocular-right",
            "binocular-independent",
            "binocular-fused",
        ],
        default="binocular-independent",
    )
    p.add_argument(
        "--content-motion",
        action="store_true",
        help="simulate simultaneous content rotation and free movement",
    )
    p.add_argument("--duration-ms", type=float, default=800)
    p.add_argument("--output")
    args = parser.parse_args()
    try:
        if args.command == "replay":
            source = _read(args.file)
            session = replay(source)
            if args.full:
                result = session.export()
            else:
                aligned = session.aligned
                exact = _same_value(aligned, source["aligned"])
                conformant = exact or _cross_language_match(aligned, source["aligned"])
                result = {
                    "schemaVersion": source["schemaVersion"],
                    "alignedSamples": len(aligned),
                    "pendingSamples": len(session.pending),
                    "replayExact": exact,
                    "replayConformant": conformant,
                    "comparison": "cross-language" if args.cross_language else "exact",
                    **(
                        {
                            "geometryTolerance": {
                                "absolute": GEOMETRY_ABS_TOLERANCE,
                                "relative": GEOMETRY_REL_TOLERANCE,
                            }
                        }
                        if args.cross_language
                        else {}
                    ),
                }
                accepted = conformant if args.cross_language else exact
                if not accepted:
                    if conformant:
                        raise ValueError(
                            "Replayed geometry differs numerically; use --cross-language "
                            "to check the documented geometry tolerance"
                        )
                    raise ValueError("Replayed alignments differ")
        elif args.command == "align-events":
            session = execute_experiment(_read(args.file))
            result = (
                {
                    "aligned": session.aligned,
                    "diagnostics": session.diagnostics.report(),
                    "pendingSamples": len(session.pending),
                }
                if args.aligned_only
                else session.export()
            )
        elif args.command == "normalize-fixtures":
            fixture = _read(args.file)
            classes = {
                "model": ModelAdapter,
                "tobii": TobiiProAdapter,
                "eyelink": EyeLinkAdapter,
                "pupil": PupilCoreAdapter,
            }
            result = []
            for case in fixture["cases"]:
                adapter = classes[case["adapter"]](
                    {**fixture["base"], **case["options"]}
                )
                result.append(
                    {
                        "name": case["name"],
                        "source": adapter.source,
                        "results": [
                            (
                                adapter.adapt_surface(p)
                                if case.get("method") == "surface"
                                else adapter.adapt(p)
                            )
                            for p in case["packets"]
                        ],
                    }
                )
        else:
            config = {
                "width": args.width,
                "height": args.height,
                "displayHz": args.display_hz,
                "inputHz": args.input_hz,
                "gazeHz": args.gaze_hz,
                "mode": args.mode,
                "durationMs": args.duration_ms,
                "contentMotion": args.content_motion,
            }
            if args.right_gaze_hz is not None:
                config["rightGazeHz"] = args.right_gaze_hz
            if args.physical_width_m is not None:
                config["physicalWidthMeters"] = args.physical_width_m
            if args.physical_height_m is not None:
                config["physicalHeightMeters"] = args.physical_height_m
            experiment = generate_experiment(config)
            session = execute_experiment(experiment)
            result = summarize_experiment(experiment, session)
            if args.output:
                path = Path(args.output)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(session.export(), allow_nan=False))
        print(json.dumps(result, allow_nan=False, separators=(",", ":")))
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(f"GazeSync input error: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
