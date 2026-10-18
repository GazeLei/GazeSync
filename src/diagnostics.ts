import type {
  Diagnostic,
  DiagnosticIssue,
  DiagnosticReport,
  Eye,
  GazeSample,
  PresentationRecord,
  SourceDescriptor,
  StreamRate,
} from "./types.js";

export const diagnosticCatalog: Record<
  string,
  { severity: Diagnostic["severity"]; message: string; remedy: string }
> = {
  SOURCE_UNREGISTERED: {
    severity: "warning",
    message: "Source metadata is missing.",
    remedy: "Register a source descriptor before its first sample.",
  },
  EYE_UNSPECIFIED: {
    severity: "info",
    message: "The observation does not identify an eye.",
    remedy:
      "Declare left, right or combined when the source provides that identity; never infer it from coordinates.",
  },
  CONFIDENCE_UNAVAILABLE: {
    severity: "info",
    message: "The source supplies validity without a scalar confidence.",
    remedy:
      "Keep confidence null and use the source validity flag; do not manufacture a probability.",
  },
  SOURCE_RATE_DEVIATION: {
    severity: "warning",
    message: "Observed capture cadence differs from the declared rate.",
    remedy:
      "Inspect missing samples, source configuration and timestamp units. Register a new source ID for a changed acquisition profile.",
  },
  SOURCE_GAP: {
    severity: "warning",
    message: "A capture gap exceeds the expected sampling interval.",
    remedy:
      "Keep the gap in the recording; inspect tracker loss or transport buffering.",
  },
  OUT_OF_ORDER: {
    severity: "info",
    message: "A sample arrived behind a newer capture timestamp.",
    remedy:
      "Use capture timestamps and an appropriate reorder/history budget; do not replace them with receipt time.",
  },
  PRESENTATION_GAP: {
    severity: "warning",
    message: "Per-frame presentation logging contains a timing gap.",
    remedy:
      "Record each displayed intermediate state or explicitly choose change-only logging for a static state.",
  },
  HISTORY_EXPIRED: {
    severity: "warning",
    message: "The required presentation history is unavailable.",
    remedy:
      "Increase maxFrames or persist the complete source log for offline reconstruction.",
  },
  CLOCK_UNCERTAIN: {
    severity: "warning",
    message: "Clock uncertainty exceeds the configured bound.",
    remedy:
      "Measure clock alignment and drift or set a justified tolerance; do not guess the offset.",
  },
  FUTURE_CAPTURE: {
    severity: "error",
    message: "Capture time is later than receipt beyond its uncertainty.",
    remedy:
      "Check seconds/milliseconds/microseconds and the clock origin before using this source.",
  },
  SURFACE_MISMATCH: {
    severity: "warning",
    message:
      "The exposure-time layout epoch does not match the retained surface.",
    remedy:
      "Tag samples with layout context at exposure and record orientation/window changes.",
  },
  GEOMETRY_UNAVAILABLE: {
    severity: "warning",
    message:
      "A 3D observation cannot be projected into the registered display.",
    remedy:
      "Provide measured origin, coordinate frame and display pose. A direction alone cannot establish a display crossing.",
  },
  RECORDING_TRUNCATED: {
    severity: "warning",
    message: "The in-memory raw log has reached its retention limit.",
    remedy:
      "Persist source chunks before rollover or use a larger explicit recording budget.",
  },
  BINOCULAR_PARTIAL: {
    severity: "info",
    message: "A declared binocular capture contains a missing or invalid eye.",
    remedy:
      "Retain independent validity for each eye; do not fill one eye from the other or from a fused estimate.",
  },
  SURFACE_REGISTRATION_REQUIRED: {
    severity: "warning",
    message:
      "Scene-camera coordinates have no declared mapping to the stimulus surface.",
    remedy:
      "Use registered surface data, an explicit calibrated mapping, or a measured 3D display plane.",
  },
  VENDOR_TIMESTAMP_ESTIMATE: {
    severity: "info",
    message:
      "The vendor timestamp is an estimate rather than a verified exposure time.",
    remedy:
      "Preserve the timestamp provenance and measure its uncertainty for the experiment.",
  },
  CALLBACK_FAILED: {
    severity: "warning",
    message: "A diagnostics callback raised an exception.",
    remedy:
      "Handle errors in the observer; diagnostic delivery must not interrupt data acquisition.",
  },
  REUSED_EYE_SAMPLE: {
    severity: "info",
    message: "A vendor binocular packet reused an already emitted eye sample.",
    remedy:
      "Keep one independent observation per eye exposure; retain the vendor aggregate separately if required.",
  },
  DISPLAY_LAYOUT_REQUIRED: {
    severity: "warning",
    message: "Full-display gaze has no recorded display-to-viewport layout.",
    remedy:
      "Record display dimensions and the viewport offset in consistent logical units.",
  },
  EXPOSURE_TIME_REQUIRED: {
    severity: "warning",
    message: "Only host receipt time is available for this source.",
    remedy:
      "Preserve the original capture timestamp. Receipt-only records are retained but excluded from capture-time attention analysis.",
  },
};

interface StreamState {
  rate: StreamRate;
  times: number[];
  newest: number;
  expected?: number;
  lastRateNotice: number;
}

/** Warnings are aggregated and cadence windows are bounded; observers receive first occurrences. */
export class Diagnostics {
  private issues = new Map<string, DiagnosticIssue>();
  private streams = new Map<string, StreamState>();
  private surfaces = new Map<string, number>();
  constructor(private onDiagnostic?: (event: Diagnostic) => void) {}

  emit(
    code: string,
    timeMs: number,
    context: { sourceId?: string; eye?: Eye; surfaceId?: string } = {},
  ): void {
    const entry = diagnosticCatalog[code];
    if (!entry) throw new Error(`Unknown diagnostic: ${code}`);
    const key = JSON.stringify([
      code,
      context.sourceId,
      context.eye,
      context.surfaceId,
    ]);
    const existing = this.issues.get(key);
    if (existing) {
      existing.count++;
      existing.lastTimeMs = Math.max(existing.lastTimeMs, timeMs);
      return;
    }
    const event = { code, ...entry, timeMs, ...context };
    this.issues.set(key, { ...event, count: 1, lastTimeMs: timeMs });
    try {
      this.onDiagnostic?.(structuredClone(event));
    } catch {
      if (code !== "CALLBACK_FAILED") {
        const previous = this.issues.get("callback-failed");
        this.issues.set("callback-failed", {
          code: "CALLBACK_FAILED",
          ...diagnosticCatalog.CALLBACK_FAILED,
          timeMs: previous?.timeMs ?? timeMs,
          count: (previous?.count ?? 0) + 1,
          lastTimeMs: Math.max(previous?.lastTimeMs ?? timeMs, timeMs),
        });
      }
    }
  }

  gaze(
    sample: GazeSample,
    captureTimeMs: number,
    source?: SourceDescriptor,
  ): void {
    const context = { sourceId: sample.sourceId, eye: sample.eye };
    if (!source) this.emit("SOURCE_UNREGISTERED", captureTimeMs, context);
    if (sample.eye === "unknown")
      this.emit("EYE_UNSPECIFIED", captureTimeMs, context);
    if (sample.confidence === null)
      this.emit("CONFIDENCE_UNAVAILABLE", captureTimeMs, context);
    if (source?.timestampKind && source.timestampKind !== "exposure")
      this.emit("VENDOR_TIMESTAMP_ESTIMATE", captureTimeMs, context);
    const key = JSON.stringify([
      sample.sourceId,
      sample.eye,
      sample.type,
      sample.clockId,
      sample.clockEpoch,
    ]);
    let stream = this.streams.get(key);
    if (!stream) {
      stream = {
        rate: {
          sourceId: sample.sourceId,
          eye: sample.eye,
          type: sample.type,
          clockId: sample.clockId,
          clockEpoch: sample.clockEpoch,
          observedHz: null,
          samples: 0,
        },
        times: [],
        newest: captureTimeMs,
        expected: source?.eyeRatesHz?.[sample.eye] ?? source?.expectedHz,
        lastRateNotice: -Infinity,
      };
      this.streams.set(key, stream);
    } else {
      const delta = captureTimeMs - stream.newest;
      if (delta < 0) this.emit("OUT_OF_ORDER", captureTimeMs, context);
      if (stream.expected && delta > (3 * 1000) / stream.expected)
        this.emit("SOURCE_GAP", captureTimeMs, context);
      stream.newest = Math.max(stream.newest, captureTimeMs);
    }
    stream.rate.samples++;
    const times = stream.times;
    let lo = 0,
      hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (times[mid] < captureTimeMs) lo = mid + 1;
      else hi = mid;
    }
    if (times[lo] !== captureTimeMs) times.splice(lo, 0, captureTimeMs);
    while (
      times.length > 2048 ||
      (times.length > 2 && times[0] < stream.newest - 2000)
    )
      times.shift();
    const span = times.at(-1)! - times[0];
    const rate = span > 0 ? ((times.length - 1) * 1000) / span : 0;
    stream.rate.observedHz = rate > 0 && Number.isFinite(rate) ? rate : null;
    const minSpan = stream.expected
      ? Math.min(1000, (1800 * 1000) / stream.expected)
      : 1000;
    if (
      stream.expected &&
      stream.rate.observedHz !== null &&
      times.length >= 5 &&
      span >= minSpan &&
      captureTimeMs - stream.lastRateNotice >= 1000
    ) {
      stream.lastRateNotice = captureTimeMs;
      if (Math.abs(stream.rate.observedHz! / stream.expected - 1) > 0.2)
        this.emit("SOURCE_RATE_DEVIATION", captureTimeMs, context);
    }
  }

  presentation(frame: PresentationRecord): void {
    const key = JSON.stringify([frame.surface.id, frame.surface.epoch]),
      prior = this.surfaces.get(key);
    const expected = frame.surface.expectedPresentationHz;
    if (
      prior !== undefined &&
      expected &&
      frame.surface.presentationMode === "per-frame" &&
      frame.t - prior > (2.5 * 1000) / expected
    ) {
      this.emit("PRESENTATION_GAP", frame.t, { surfaceId: frame.surface.id });
    }
    this.surfaces.set(key, frame.t);
  }

  aligned(
    flags: string[],
    timeMs: number,
    sourceId: string,
    eye: Eye,
    surfaceId: string,
  ): void {
    const context = { sourceId, eye, surfaceId };
    const map: Record<string, string> = {
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
    };
    for (const flag of flags)
      if (map[flag]) this.emit(map[flag], timeMs, context);
  }

  report(): DiagnosticReport {
    return structuredClone({
      issues: [...this.issues.values()],
      streams: [...this.streams.values()].map((s) => s.rate),
    });
  }
}
