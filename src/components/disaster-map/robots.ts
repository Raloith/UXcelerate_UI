import { MAP_HALF, type GeneratedDisasterMap } from "./generateDisasterMap";
import { createSeededRNG } from "./rng";

/**
 * Deployed near the south edge of the site - a plausible "staging point"
 * where a rescue convoy would set up before fanning out across the rubble.
 * Sits right at the mouth of the north-south corridor (see
 * generateDisasterMap.ts's `corridor-ns`, which starts at [0, -MAP_HALF]).
 */
const ROBOT_BASE: [number, number] = [0, -MAP_HALF + 14];

/** Distinct "friendly unit" tactical colors, cyan-forward, easy to tell apart from hazards/survivors. */
const ROBOT_COLORS = ["#38f2ff", "#f2f7ff", "#7af0c2", "#ffd873"] as const;

export interface RescueRobot {
  id: string;
  color: string;
  /** Sensor / exploration radius, in meters. */
  radius: number;
  /** Patrol speed along its path, in meters/second. */
  speed: number;
  /** Closed-loop tour of [x, z] waypoints the robot patrols forever, starting at its base. */
  waypoints: Array<[number, number]>;
  /** Total loop length in meters, precomputed once for frame-time interpolation. */
  pathLength: number;
  basePosition: [number, number];
}

/**
 * Generate 3-4 deterministic rescue robots for a seed: shared home base
 * (with small per-robot jitter), each patrolling a seeded closed loop built
 * from the map's own route waypoints and points of interest (rubble /
 * survivors), so paths always stay plausible and reachable. Uses its own
 * derived RNG stream (`${seed}::robots`) so this never disturbs (or is
 * disturbed by) the main map generation stream.
 */
export function generateRobots(seed: string, map: GeneratedDisasterMap): RescueRobot[] {
  const rng = createSeededRNG(`${seed}::robots`);
  const count = rng.int(3, 4);

  const interestPoints: Array<[number, number]> = [
    ...map.routes.map((r) => [r.position[0], r.position[2]] as [number, number]),
    ...map.rubble.slice(0, 14).map((r) => [r.position[0], r.position[2]] as [number, number]),
    ...map.survivors.slice(0, 12).map((s) => [s.position[0], s.position[2]] as [number, number]),
  ];
  if (interestPoints.length === 0) interestPoints.push(ROBOT_BASE);

  const robots: RescueRobot[] = [];
  for (let n = 0; n < count; n++) {
    const basePosition: [number, number] = [
      ROBOT_BASE[0] + rng.range(-6, 6),
      ROBOT_BASE[1] + rng.range(-3, 3),
    ];

    const stopCount = rng.int(5, 8);
    const stops: Array<[number, number]> = [];
    for (let s = 0; s < stopCount; s++) {
      stops.push(rng.pick(interestPoints));
    }

    const waypoints = [basePosition, ...stops];
    let pathLength = 0;
    for (let i = 0; i < waypoints.length; i++) {
      const a = waypoints[i];
      const b = waypoints[(i + 1) % waypoints.length];
      pathLength += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }

    robots.push({
      id: `robot-${n}`,
      color: ROBOT_COLORS[n % ROBOT_COLORS.length],
      radius: rng.range(15, 25),
      speed: rng.range(3.2, 5.2),
      waypoints,
      pathLength,
      basePosition,
    });
  }
  return robots;
}

/**
 * Interpolate a robot's current [x, z] along its closed-loop patrol path at
 * a given cumulative distance traveled (distance is expected to only grow,
 * driven by `useFrame` delta * speed each frame - this function handles the
 * wraparound so the tour loops forever).
 */
export function sampleRobotPosition(
  robot: RescueRobot,
  distance: number
): [number, number] {
  const { waypoints, pathLength } = robot;
  if (waypoints.length === 0) return [0, 0];
  if (pathLength <= 1e-6) return waypoints[0];

  let remaining = distance % pathLength;
  if (remaining < 0) remaining += pathLength;

  for (let i = 0; i < waypoints.length; i++) {
    const a = waypoints[i];
    const b = waypoints[(i + 1) % waypoints.length];
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (segLen <= 1e-6) continue;
    if (remaining <= segLen) {
      const t = remaining / segLen;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    remaining -= segLen;
  }
  return waypoints[0];
}
