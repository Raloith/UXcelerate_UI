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

/** Small deterministic set of mission-relevant payloads, one assigned per robot. */
const PAYLOAD_TYPES = [
  "Thermal Imager",
  "Medkit Drop",
  "Debris Claw",
  "Comms Relay",
] as const;

/** Simulated UHF telemetry band the fleet's per-robot coordination channels are drawn from - purely cosmetic flavor text. */
const CHANNEL_FREQUENCY_MIN_MHZ = 410;
const CHANNEL_FREQUENCY_MAX_MHZ = 470;

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
  /** Seeded mission-equipment label shown in the Robot Fleet Status HUD drawer. */
  payload: string;
  /** Seeded starting battery charge (%), before runtime drain is applied. */
  batteryStart: number;
  /** Deterministic battery drain rate (% per minute of session elapsed time). */
  drainRatePercentPerMin: number;
  /** Seeded phase offset for this robot's simulated RSSI wobble. */
  rssiPhase: number;
  /** Seeded coordination-channel label shown in the Robot Fleet Status HUD (e.g. "CH-2"). */
  channelLabel: string;
  /** Seeded simulated comms frequency (MHz) for that same channel, purely cosmetic flavor text. */
  channelFrequencyMHz: number;
}

/** Clamp `v` to the inclusive [min, max] range. */
function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Normalize an angle (radians) into [0, 2π). */
function normalizeAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  let a = angle % twoPi;
  if (a < 0) a += twoPi;
  return a;
}

/** True if normalized `angle` falls in the half-open arc [start, start + span), wrapping past 2π correctly. */
function isAngleInSector(angle: number, start: number, span: number): boolean {
  return normalizeAngle(angle - start) < span;
}

/**
 * Minimum number of candidate points a robot's assigned map sector should
 * have before its patrol tour is considered "well distributed". Below
 * this, fallbacks kick in (borrow from neighboring sectors, then
 * synthesize deterministic points) so every robot still gets a reasonable
 * loop regardless of how the seeded map's entities happen to cluster.
 */
const MIN_ZONE_CANDIDATES = 8;
/** Hard cap on synthetic (non-entity) fallback waypoints per robot, so a totally empty sector still gets bounded extra work. */
const MAX_SYNTHETIC_WAYPOINTS = 8;
/** Radius band (meters from base) used when synthesizing fallback waypoints directly from map coordinates. */
const SYNTHETIC_RADIUS_MIN = 18;
const SYNTHETIC_RADIUS_MARGIN_FROM_EDGE = 10;

/**
 * Generate 3-4 deterministic rescue robots for a seed: shared home base
 * (with small per-robot jitter), each patrolling a seeded closed loop built
 * from the map's own route waypoints and points of interest (rubble /
 * survivors), so paths always stay plausible and reachable. Uses its own
 * derived RNG stream (`${seed}::robots`) so this never disturbs (or is
 * disturbed by) the main map generation stream.
 *
 * To keep the fleet spread out instead of retreading the same ground, the
 * map is first split into `count` equal angular sectors (wedges) around
 * the shared base, with a small seeded rotation so the fan-out orientation
 * still varies per seed. Each robot is assigned one distinct wedge and its
 * waypoint tour is built almost entirely from candidate points (routes /
 * rubble / survivors) that fall inside that wedge - so robots naturally
 * patrol different regions of the map rather than sampling from one
 * shared, unpartitioned pool. If a robot's wedge is too sparse (uneven
 * entity distribution for a given seed), it first borrows the closest
 * points from neighboring wedges, then - if still short - synthesizes a
 * few extra deterministic waypoints spread across its own wedge directly
 * from map coordinates, so no robot ever gets stranded with a degenerate
 * loop.
 */
export function generateRobots(seed: string, map: GeneratedDisasterMap): RescueRobot[] {
  const rng = createSeededRNG(`${seed}::robots`);
  const count = rng.int(3, 4);

  // Deliberately not sliced down to a small handful - the fuller the pool,
  // the more likely every angular wedge below has enough real candidates
  // to draw a tour from without needing synthetic fallback points.
  const interestPoints: Array<[number, number]> = [
    ...map.routes.map((r) => [r.position[0], r.position[2]] as [number, number]),
    ...map.rubble.map((r) => [r.position[0], r.position[2]] as [number, number]),
    ...map.survivors.map((s) => [s.position[0], s.position[2]] as [number, number]),
  ];
  if (interestPoints.length === 0) interestPoints.push(ROBOT_BASE);

  // --- Spatial partition: one distinct angular sector per robot ----------
  const sectorSpan = (Math.PI * 2) / count;
  const sectorRotation = rng.range(0, Math.PI * 2);
  const angleFromBase = (p: [number, number]) =>
    normalizeAngle(Math.atan2(p[1] - ROBOT_BASE[1], p[0] - ROBOT_BASE[0]));

  const robots: RescueRobot[] = [];
  for (let n = 0; n < count; n++) {
    const basePosition: [number, number] = [
      ROBOT_BASE[0] + rng.range(-6, 6),
      ROBOT_BASE[1] + rng.range(-3, 3),
    ];

    const sectorStart = sectorRotation + n * sectorSpan;

    // Primary candidates: real map points whose angle from base lands
    // inside this robot's own wedge.
    const zonePoints: Array<[number, number]> = interestPoints.filter((p) =>
      isAngleInSector(angleFromBase(p), sectorStart, sectorSpan)
    );

    // Fallback 1: this wedge is sparse - borrow the angularly-closest
    // points from neighboring wedges rather than leaving the tour thin.
    if (zonePoints.length < MIN_ZONE_CANDIDATES) {
      const zoneSet = new Set(zonePoints);
      const borrowed = interestPoints
        .filter((p) => !zoneSet.has(p))
        .map((p) => {
          const rel = normalizeAngle(angleFromBase(p) - sectorStart);
          const overshoot = rel - sectorSpan; // how far past this wedge's far edge
          const distance = Math.min(overshoot, Math.PI * 2 - rel); // or wrap the other way, toward the near edge
          return { p, distance };
        })
        .sort((a, b) => a.distance - b.distance);
      for (const { p } of borrowed) {
        if (zonePoints.length >= MIN_ZONE_CANDIDATES) break;
        zonePoints.push(p);
      }
    }

    // Fallback 2: still sparse (e.g. a wedge that mostly points off the
    // edge of the map near the base) - synthesize a few extra deterministic
    // waypoints spread across this wedge's own angle/radius range directly
    // from map coordinates, clamped to stay on the map.
    let synthesized = 0;
    while (zonePoints.length < MIN_ZONE_CANDIDATES && synthesized < MAX_SYNTHETIC_WAYPOINTS) {
      const angle = sectorStart + rng.next() * sectorSpan;
      const radius = rng.range(SYNTHETIC_RADIUS_MIN, MAP_HALF - SYNTHETIC_RADIUS_MARGIN_FROM_EDGE);
      const edge = MAP_HALF - 6;
      const x = clamp(ROBOT_BASE[0] + Math.cos(angle) * radius, -edge, edge);
      const z = clamp(ROBOT_BASE[1] + Math.sin(angle) * radius, -edge, edge);
      zonePoints.push([x, z]);
      synthesized++;
    }

    const stopCount = rng.int(5, 8);
    const stops: Array<[number, number]> = [];
    for (let s = 0; s < stopCount; s++) {
      stops.push(rng.pick(zonePoints));
    }
    // Order stops by distance from base so the loop sweeps outward through
    // the robot's own wedge and back, instead of zigzagging between
    // near/far picks in an arbitrary order (which reads as jittery,
    // crossing-over motion rather than a clean patrol sweep).
    stops.sort(
      (a, b) =>
        Math.hypot(a[0] - basePosition[0], a[1] - basePosition[1]) -
        Math.hypot(b[0] - basePosition[0], b[1] - basePosition[1])
    );

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
      // Roughly 35% smaller than the original 15-25m sensor sweep, so a
      // full-map exploration takes meaningfully longer (see fogOfWar.ts).
      radius: rng.range(10, 16),
      // Roughly half the original 3.2-5.2 m/s patrol pace - still visibly
      // on the move, just a calmer sweep of the site.
      speed: rng.range(1.6, 2.6),
      waypoints,
      pathLength,
      basePosition,
      payload: rng.pick(PAYLOAD_TYPES),
      batteryStart: rng.range(72, 100),
      drainRatePercentPerMin: rng.range(0.4, 1.3),
      rssiPhase: rng.next() * Math.PI * 2,
      channelLabel: `CH-${n + 1}`,
      channelFrequencyMHz:
        Math.round(rng.range(CHANNEL_FREQUENCY_MIN_MHZ, CHANNEL_FREQUENCY_MAX_MHZ) * 100) / 100,
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
