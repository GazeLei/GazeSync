"""Small offline CLI; never opens a hardware connection or uploads data."""

from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys
from .adapters import ModelAdapter, TobiiProAdapter, EyeLinkAdapter, PupilCoreAdapter
from .experiments import generate_experiment, execute_experiment, summarize_experiment
from .session import replay


def _read(path):
    return json.load(sys.stdin) if path == "-" else json.loads(Path(path).read_text())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("replay")
    p.add_argument("file")
    p.add_argument("--full", action="store_true")
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
    p.add_argument("--duration-ms", type=float, default=800)
    p.add_argument("--output")
    args = parser.parse_args()
    try:
        if args.command == "replay":
            source = _read(args.file)
            session = replay(source)
            result = (
                session.export()
                if args.full
                else {
                    "schemaVersion": source["schemaVersion"],
                    "alignedSamples": len(session.aligned),
                    "pendingSamples": len(session.pending),
                    "replayExact": session.aligned == source["aligned"],
                }
            )
            if not args.full and not result["replayExact"]:
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
                            adapter.adapt_surface(p)
                            if case.get("method") == "surface"
                            else adapter.adapt(p)
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
            }
            if args.right_gaze_hz is not None:
                config["rightGazeHz"] = args.right_gaze_hz
            experiment = generate_experiment(config)
            session = execute_experiment(experiment)
            result = summarize_experiment(experiment, session)
            if args.output:
                path = Path(args.output)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(session.export(), allow_nan=False))
        print(json.dumps(result, allow_nan=False, separators=(",", ":")))
    except (ValueError, TypeError, KeyError) as error:
        print(f"GazeSync input error: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
