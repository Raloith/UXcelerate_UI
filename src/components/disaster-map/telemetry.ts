/**
 * Pure, framework-agnostic logic backing the mission HUD's "live" telemetry:
 * per-robot battery/signal/task derivation, and hazard/survivor "reveal
 * event" log entries. Kept separate from TelemetryTracker.tsx (the R3F
 * component that drives this every frame) so the actual math is easy to
 * read/test without any Fiber/Three types in the way - same split as
 * generateDisasterMap.ts (logic) vs DisasterMap3D.tsx (rendering).
 *
 * Nothing here calls Math.random() - battery/RSSI derive from each robot's
 * seeded identity fields (see robots.ts) plus the live elapsed session time
 * / position, so results are reproducible given the same inputs.
 */

import type { GeneratedDisasterMap, MapEntity } from "./generateDisasterMap";
import type { RescueRobot } from "./robots";

/** Live [x, z] position for a robot, keyed by robot id. Written every frame by RobotUnit, read (throttled) by TelemetryTracker. */
export type RobotPositions = Record<string, { x: number; z: number }>;

export type RobotTask =
  | "Patrolling Sector"
  | "Approaching Survivor"
  | "Investigating Hazard"
  | "Returning to Base";

export interface RobotTelemetry {
  id: string;
  /** Human-readable "UNIT-01" style label derived from the id. */
  label: string;
  color: string;
  payload: string;
  batteryPercent: number;
  rssiDbm: number;
  task: RobotTask;
}

export type FeedKind = "hazard" | "blocked-path" | "survivor";
export type FeedSeverity = "info" | "warning" | "critical";

export interface FeedEntry {
  id: string;
  /** Seconds elapsed since the current seed's session started. */
  timestampSeconds: number;
  robotLabel: string;
  kind: FeedKind;
  title: string;
  detail: string;
  /** Rounded world (x, z), for compact monospace display. */
  position: [number, number];
  severity: FeedSeverity;
}

export interface TelemetrySnapshot {
  elapsedSeconds: number;
  survivorsFound: number;
  survivorsTotal: number;
  robots: RobotTelemetry[];
  /** Only the feed entries created since the previous flush - append, don't replace. */
  newFeedEntries: FeedEntry[];
}

/** A fog cell counts as "revealed" for HUD purposes (survivor found / log entry) once explored crosses this. */
export const REVEAL_LOG_THRESHOLD = 0.6;

const NEAR_ENTITY_RADIUS = 7;
const NEAR_BASE_RADIUS = 10;
/** Rough max distance a robot ever strays from base, for normalizing the RSSI falloff. */
const MAX_RSSI_DISTANCE = 130;
const BATTERY_FLOOR = 6;

/** "robot-2" -> "UNIT-03" (1-indexed, matches how a rescue squad would label units). */
export function formatRobotLabel(robotId: string): string {
  const n = parseInt(robotId.replace(/[^0-9]/g, ""), 10) || 0;
  return `UNIT-${String(n + 1).padStart(2, "0")}`;
}

/** Infer a plausible short status label from a robot's live position relative to base/survivors/hazards. */
export function deriveRobotTask(
  map: GeneratedDisasterMap,
  x: number,
  z: number,
  distanceFromBase: number
): RobotTask {
  if (distanceFromBase < NEAR_BASE_RADIUS) return "Returning to Base";

  let nearestSurvivor = Infinity;
  for (const s of map.survivors) {
    const d = Math.hypot(x - s.position[0], z - s.position[2]);
    if (d < nearestSurvivor) nearestSurvivor = d;
  }
  if (nearestSurvivor < NEAR_ENTITY_RADIUS) return "Approaching Survivor";

  let nearestHazard = Infinity;
  for (const h of map.hazards) {
    const d = Math.hypot(x - h.position[0], z - h.position[2]);
    if (d < nearestHazard) nearestHazard = d;
  }
  for (const b of map.blockedPaths) {
    const d = Math.hypot(x - b.position[0], z - b.position[2]);
    if (d < nearestHazard) nearestHazard = d;
  }
  if (nearestHazard < NEAR_ENTITY_RADIUS) return "Investigating Hazard";

  return "Patrolling Sector";
}

/** Derive one robot's current battery/signal/task row from its seeded identity + live position + elapsed time. */
export function computeRobotTelemetry(
  robot: RescueRobot,
  livePosition: { x: number; z: number } | undefined,
  map: GeneratedDisasterMap,
  elapsedSeconds: number
): RobotTelemetry {
  const x = livePosition?.x ?? robot.basePosition[0];
  const z = livePosition?.z ?? robot.basePosition[1];
  const distanceFromBase = Math.hypot(
    x - robot.basePosition[0],
    z - robot.basePosition[1]
  );

  // Slow deterministic drain, purely a function of elapsed session time -
  // no accumulation/ref state needed, and it naturally "resets" whenever
  // the session resets (new seed).
  const drained = robot.drainRatePercentPerMin * (elapsedSeconds / 60);
  const batteryPercent = Math.round(
    Math.min(100, Math.max(BATTERY_FLOOR, robot.batteryStart - drained))
  );

  // RSSI falls off with distance from base, plus a gentle seeded sine
  // wobble so it never looks perfectly static.
  const normalized = Math.min(1, Math.max(0, distanceFromBase / MAX_RSSI_DISTANCE));
  const wobble = Math.sin(elapsedSeconds * 0.5 + robot.rssiPhase) * 4;
  const rssiDbm = Math.round(-45 - normalized * 42 + wobble);

  return {
    id: robot.id,
    label: formatRobotLabel(robot.id),
    color: robot.color,
    payload: robot.payload,
    batteryPercent,
    rssiDbm,
    task: deriveRobotTask(map, x, z, distanceFromBase),
  };
}

/** Build one feed log entry for a hazard/blocked-path/survivor entity whose fog cell just crossed the reveal threshold. */
export function makeFeedEntry(
  entity: MapEntity,
  nearestRobotId: string,
  elapsedSeconds: number,
  seq: number
): FeedEntry {
  const position: [number, number] = [
    Math.round(entity.position[0]),
    Math.round(entity.position[2]),
  ];
  const robotLabel = formatRobotLabel(nearestRobotId);
  const base = {
    id: `feed-${seq}-${entity.id}`,
    timestampSeconds: elapsedSeconds,
    robotLabel,
    position,
  };

  if (entity.type === "survivor") {
    const status = String(entity.metadata.status ?? "unknown").toUpperCase();
    return {
      ...base,
      kind: "survivor",
      title: "SURVIVOR LOCATED",
      detail: `STATUS: ${status}`,
      severity: status === "CRITICAL" ? "critical" : "info",
    };
  }

  if (entity.type === "hazard") {
    const style =
      entity.metadata.style === "wireframe"
        ? "WIRE-FRAME COLLAPSE RISK"
        : "STRUCTURAL EMBER HAZARD";
    const severityRaw = String(entity.metadata.severity ?? "warning");
    return {
      ...base,
      kind: "hazard",
      title: "HAZARD DETECTED",
      detail: style,
      severity: severityRaw === "critical" ? "critical" : "warning",
    };
  }

  // blocked-path
  const severityRaw = String(entity.metadata.severity ?? "moderate");
  return {
    ...base,
    kind: "blocked-path",
    title: "BLOCKED PATH DETECTED",
    detail: `${severityRaw.toUpperCase()} DEBRIS BLOCKAGE`,
    severity: severityRaw === "severe" ? "critical" : "warning",
  };
}
