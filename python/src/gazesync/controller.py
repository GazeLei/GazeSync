"""Platform-neutral pointer/wheel/key gestures for native Python hosts."""

from __future__ import annotations
import copy
import math
from typing import Any, Callable, Mapping
from .geometry import (
    clamp,
    constrain,
    create_view,
    finite,
    pan_by,
    point,
    positive,
    reset_view,
    resize_view,
    zoom_at,
    zoom_level,
    zoom_to_box,
)


def _distance(a: Mapping[str, float], b: Mapping[str, float]) -> float:
    return math.hypot(a["x"] - b["x"], a["y"] - b["y"])


def _middle(a: Mapping[str, float], b: Mapping[str, float]) -> dict[str, float]:
    return {"x": (a["x"] + b["x"]) / 2, "y": (a["y"] + b["y"]) / 2}


class ZoomController:
    def __init__(
        self,
        view: Mapping[str, float],
        *,
        on_input: Callable[[dict[str, Any]], None] | None = None,
        drag_threshold: float = 5,
        double_tap_ms: float = 320,
        double_tap_distance: float = 24,
        input_prefix: str = "input",
    ) -> None:
        for value, name in (
            (drag_threshold, "dragThreshold"),
            (double_tap_ms, "doubleTapMs"),
            (double_tap_distance, "doubleTapDistance"),
        ):
            positive(value, name)
        if not isinstance(input_prefix, str) or not input_prefix:
            raise ValueError("inputPrefix must be a nonempty string")
        create_view(
            view["width"],
            view["height"],
            view["contentWidth"],
            view["contentHeight"],
            view["minZoom"],
            view["maxZoom"],
        )
        positive(view["scale"], "view.scale")
        finite(view["tx"], "view.tx")
        finite(view["ty"], "view.ty")
        self.view = constrain(view)
        self.on_input = on_input or (lambda event: None)
        self.drag_threshold, self.double_tap_ms, self.double_tap_distance = (
            drag_threshold,
            double_tap_ms,
            double_tap_distance,
        )
        self.mode, self.input_prefix = "pan", input_prefix
        self.pointers: dict[Any, dict[str, Any]] = {}
        self.selection = self.gesture = self.last_tap = None
        self._sequence = 0

    def _emit(self, kind: str, t: float, **details: Any) -> dict[str, Any]:
        finite(t, "input time")
        self._sequence += 1
        event = {
            **details,
            "id": f"{self.input_prefix}-{self._sequence}",
            "t": t,
            "kind": kind,
        }
        self.on_input(copy.deepcopy(event))
        return event

    def set_mode(self, mode: str) -> None:
        if mode not in ("pan", "box"):
            raise ValueError("Mode must be pan or box")
        self.mode = mode

    def wheel(
        self, *, x: float, y: float, delta_y: float, t: float, delta_mode: int = 0
    ) -> None:
        point({"x": x, "y": y})
        finite(delta_y, "deltaY")
        finite(t, "input time")
        if delta_mode not in (0, 1, 2):
            raise ValueError("Unknown wheel deltaMode")
        if self.pointers:
            self.cancel(t, "wheel-interrupt")
        pixels = delta_y * (
            16 if delta_mode == 1 else self.view["height"] if delta_mode == 2 else 1
        )
        self.view = zoom_at(
            self.view, math.exp(clamp(-pixels * 0.002, -4, 4)), {"x": x, "y": y}
        )
        self._emit("wheel", t, x=x, y=y, deltaY=delta_y, deltaMode=delta_mode)

    def zoom(
        self, factor: float, t: float, anchor: Mapping[str, float] | None = None
    ) -> None:
        finite(t, "input time")
        anchor = (
            {"x": self.view["width"] / 2, "y": self.view["height"] / 2}
            if anchor is None
            else anchor
        )
        next_view = zoom_at(self.view, factor, anchor)
        if self.pointers:
            self.cancel(t, "zoom-interrupt")
        self.view = next_view
        self._emit("zoom", t, factor=factor, anchor=anchor)

    def reset(self, t: float) -> None:
        self.cancel(t, "reset")
        self.view = reset_view(self.view)
        self._emit("reset", t)

    def resize(self, width: float, height: float, t: float) -> None:
        next_view = resize_view(self.view, width, height)
        self.cancel(t, "layout-change")
        self.view = next_view
        self._emit("resize", t, width=width, height=height)

    def _rebase(self) -> None:
        pointers = list(self.pointers.values())
        self.selection = None
        if len(pointers) == 2:
            for p in pointers:
                p["pinched"] = True
            self.gesture = {
                "type": "pinch",
                "base": dict(self.view),
                "start": _middle(*pointers),
                "distance": max(_distance(*pointers), 1),
            }
        elif len(pointers) == 1:
            p = pointers[0]
            self.gesture = {
                "type": "box"
                if p["type"] == "mouse"
                and (self.mode == "box" or p["shiftKey"])
                and p["button"] != 1
                else "pan",
                "base": dict(self.view),
                "start": {"x": p["x"], "y": p["y"]},
            }
        else:
            self.gesture = None

    def pointer_down(
        self,
        *,
        id: int | str,
        x: float,
        y: float,
        t: float,
        pointer_type: str = "mouse",
        shift_key: bool = False,
        button: int = 0,
    ) -> bool:
        point({"x": x, "y": y})
        finite(t, "input time")
        if (
            id in self.pointers
            or len(self.pointers) >= 2
            or (pointer_type == "mouse" and button not in (0, 1))
        ):
            return False
        self.pointers[id] = {
            "id": id,
            "x": x,
            "y": y,
            "type": pointer_type,
            "shiftKey": shift_key,
            "button": button,
            "down": {"x": x, "y": y},
            "downTime": t,
            "moved": False,
            "pinched": False,
        }
        self._rebase()
        self._emit(
            "pointer", t, phase="down", pointerId=id, x=x, y=y, pointerType=pointer_type
        )
        return True

    def pointer_move(self, *, id: int | str, x: float, y: float, t: float) -> bool:
        point({"x": x, "y": y})
        finite(t, "input time")
        p = self.pointers.get(id)
        if p is None:
            return False
        p["x"], p["y"] = x, y
        if _distance(p["down"], p) >= self.drag_threshold:
            p["moved"] = True
        g, pointers = self.gesture, list(self.pointers.values())
        if g["type"] == "pinch":
            self.view = zoom_at(
                g["base"],
                max(_distance(*pointers), 1) / g["distance"],
                g["start"],
                _middle(*pointers),
            )
        elif p["moved"] or p["pinched"]:
            if g["type"] == "box":
                self.selection = {"start": dict(g["start"]), "end": {"x": x, "y": y}}
            else:
                self.view = pan_by(g["base"], x - g["start"]["x"], y - g["start"]["y"])
        self._emit(
            "pointer", t, phase="move", pointerId=id, x=x, y=y, gesture=g["type"]
        )
        return True

    def pointer_up(self, *, id: int | str, x: float, y: float, t: float) -> bool:
        if id not in self.pointers:
            return False
        self.pointer_move(id=id, x=x, y=y, t=t)
        p = self.pointers[id]
        if self.gesture["type"] == "box" and self.selection:
            self.view = zoom_to_box(
                self.view, self.selection["start"], self.selection["end"]
            )
            self._emit("box-zoom", t, **self.selection)
        tap = (
            p["type"] == "touch"
            and not p["moved"]
            and not p["pinched"]
            and t - p["downTime"] <= self.double_tap_ms
        )
        del self.pointers[id]
        self._rebase()
        if tap:
            if (
                self.last_tap
                and 0 <= t - self.last_tap["t"] <= self.double_tap_ms
                and _distance(p, self.last_tap) <= self.double_tap_distance
            ):
                self.double_tap(x=x, y=y, t=t)
                self.last_tap = None
            else:
                self.last_tap = {"x": x, "y": y, "t": t}
        else:
            self.last_tap = None
        self._emit("pointer", t, phase="up", pointerId=id, x=x, y=y)
        return True

    def double_tap(self, *, x: float, y: float, t: float) -> None:
        point({"x": x, "y": y})
        finite(t, "input time")
        if self.pointers:
            self.cancel(t, "double-tap-interrupt")
        self.view = (
            reset_view(self.view)
            if zoom_level(self.view) > 1.01
            else zoom_at(self.view, 2.5, {"x": x, "y": y})
        )
        self._emit("double-tap", t, x=x, y=y)

    def cancel(self, t: float, reason: str = "cancel") -> None:
        finite(t, "input time")
        active = bool(self.pointers)
        self.pointers.clear()
        self.gesture = self.selection = self.last_tap = None
        if active or reason != "cancel":
            self._emit("cancel", t, reason=reason)

    def key(
        self, key: str, t: float, *, ctrl_key: bool = False, meta_key: bool = False
    ) -> bool:
        finite(t, "input time")
        if (key == "0" and (ctrl_key or meta_key)) or key == "Home":
            self.reset(t)
        elif key == "Escape":
            if self.pointers:
                self.cancel(t, "escape")
            else:
                self.reset(t)
        elif key in ("+", "="):
            self.zoom(1.25, t)
        elif key == "-":
            self.zoom(0.8, t)
        elif key in ("ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"):
            if self.pointers:
                self.cancel(t, "key-interrupt")
            self.view = pan_by(
                self.view,
                48 if key == "ArrowLeft" else -48 if key == "ArrowRight" else 0,
                48 if key == "ArrowUp" else -48 if key == "ArrowDown" else 0,
            )
            self._emit("key-pan", t, key=key)
        else:
            return False
        return True
