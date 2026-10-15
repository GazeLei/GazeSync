"""Serialize native Python geometry results for the cross-language audit."""

import json
from pathlib import Path
import sys
from gazesync import invert_rigid_transform, transform_plane, transform_ray, project_ray

f = json.loads(Path(sys.argv[1]).read_text())
inverse = invert_rigid_transform(f["worldToCamera"])
camera_plane = transform_plane(f["plane"], f["worldToCamera"])
rows = []
for case in f["cases"]:
    ray = transform_ray(case["rayCamera"], inverse)
    rows.append(
        {
            "name": case["name"],
            "ray": ray,
            "worldHit": project_ray(ray, f["plane"], 1920, 1080),
            "cameraHit": project_ray(case["rayCamera"], camera_plane, 1920, 1080),
        }
    )
q = f["quarterTurn"]
ray = transform_ray(q["ray"], q["transform"])
print(
    json.dumps(
        dict(
            inverse=inverse,
            cameraPlane=camera_plane,
            rows=rows,
            quarterTurn=dict(
                ray=ray,
                hit=project_ray(ray, q["plane"], 1000, 1000),
                restored=transform_ray(ray, invert_rigid_transform(q["transform"])),
            ),
        ),
        allow_nan=False,
    )
)
