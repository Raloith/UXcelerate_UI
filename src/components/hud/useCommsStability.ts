import { useEffect, useMemo, useState } from "react";
import { hashStringToSeed } from "@/components/disaster-map/rng";

export type CommsTone = "nominal" | "degraded" | "critical";

export interface CommsStability {
  percent: number;
  tone: CommsTone;
}

const TICK_MS = 250;
/** Baseline + two independent slow sine wobbles => a smooth, non-jarring "noisy signal" look. */
const BASE_PERCENT = 80;
const WOBBLE_A_AMPLITUDE = 14;
const WOBBLE_B_AMPLITUDE = 9;

function toneFor(percent: number): CommsTone {
  if (percent >= 82) return "nominal";
  if (percent >= 58) return "degraded";
  return "critical";
}

/**
 * Simulated "global comms stability" metric: deterministic-looking but
 * gently wobbling, seeded per-map so different seeds get a different
 * signal "personality" without ever jumping jarringly between values.
 *
 * The seeded phases are pure derived data (`useMemo`, no impure calls), so
 * they're safe to compute during render. `Date.now()` only ever runs
 * inside the effect below - either at setup or inside the interval's own
 * callback - never directly during render.
 */
export function useCommsStability(seed: string): CommsStability {
  const phases = useMemo(() => {
    const h = hashStringToSeed(`${seed}::comms`);
    return {
      a: ((h % 1000) / 1000) * Math.PI * 2,
      b: (((h >>> 8) % 1000) / 1000) * Math.PI * 2,
    };
  }, [seed]);

  const [value, setValue] = useState<CommsStability>({
    percent: BASE_PERCENT,
    tone: toneFor(BASE_PERCENT),
  });

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      const t = (Date.now() - start) / 1000;
      const wobble =
        Math.sin(t * 0.15 + phases.a) * WOBBLE_A_AMPLITUDE +
        Math.sin(t * 0.42 + phases.b) * WOBBLE_B_AMPLITUDE;
      const percent = Math.round(
        Math.min(100, Math.max(30, BASE_PERCENT + wobble))
      );
      setValue({ percent, tone: toneFor(percent) });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [phases]);

  return value;
}
