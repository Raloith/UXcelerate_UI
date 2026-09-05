import { useEffect, useState } from "react";
import { formatElapsedClock } from "./format";

export interface MissionClock {
  /** `T+HH:MM:SS` formatted elapsed time since this hook's owner mounted. */
  label: string;
  elapsedSeconds: number;
}

/**
 * Running mission-elapsed-time clock, monospace-ready. Ticks once a second
 * via `setInterval` (a full requestAnimationFrame loop would re-render at
 * 60Hz for a value that only ever changes once a second - wasted work).
 *
 * This hook always starts at zero when its owning component *mounts* - it
 * intentionally has no "reset" parameter. To reset the clock (e.g. on a
 * new map seed), render the component that calls this hook with
 * `key={seed}` so React remounts it, rather than juggling extra
 * ref/effect reset plumbing here. `Date.now()` is only ever called inside
 * `useState`'s lazy initializer (its one sanctioned escape hatch for
 * impure initial state) or inside the interval callback below - never
 * directly during render.
 */
export function useMissionClock(): MissionClock {
  const [start] = useState(() => Date.now());
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setElapsedMs(Date.now() - start);
    }, 1000);
    return () => clearInterval(id);
  }, [start]);

  const elapsedSeconds = elapsedMs / 1000;
  return { label: formatElapsedClock(elapsedSeconds), elapsedSeconds };
}
