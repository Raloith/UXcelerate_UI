"use client";

/**
 * Invisible R3F component (returns null - it never renders a mesh) that
 * turns the fog-of-war grid + live robot positions into the HUD's "mission
 * telemetry": survivor found/pending count, per-robot battery/signal/task
 * rows, and the scrolling hazard/survivor feed log. Also assigns each
 * newly-found survivor a permanent "escort" robot (nearest one at the
 * moment of discovery), written into `escortRef` for SurvivorMarker to
 * read every frame.
 *
 * Perf note: the reveal-event scan below runs every frame (cheap - it's a
 * flat 1600-cell array read), but it only ever *writes* to refs. Pushing
 * anything into React state (via `onTelemetryUpdate`) is throttled to
 * ~4Hz, exactly the "don't setState from useFrame every frame" guardrail
 * that this project's fog-of-war work already established.
 */

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { MutableRefObject } from "react";

import type { GeneratedDisasterMap, MapEntity } from "./generateDisasterMap";
import type { FogOfWarState } from "./fogOfWar";
import type { RescueRobot } from "./robots";
import type { RobotCommsStates } from "./commsDrop";
import {
  computeRobotTelemetry,
  makeFeedEntry,
  REVEAL_LOG_THRESHOLD,
  type FeedEntry,
  type RobotPositions,
  type SurvivorEscortMap,
  type TelemetrySnapshot,
} from "./telemetry";

const FLUSH_INTERVAL_MS = 250;

export interface TelemetryTrackerProps {
  map: GeneratedDisasterMap;
  robots: RescueRobot[];
  fog: FogOfWarState;
  positionsRef: MutableRefObject<RobotPositions>;
  /** Live per-robot comms-link state (green/amber/red), written every frame by RobotUnit's comms-drop simulation - read here (throttled) to fold into each robot's telemetry row. */
  commsStateRef: MutableRefObject<RobotCommsStates>;
  /** One-time reverse lookup: fog cell index -> hazard/blocked-path/survivor entities sitting in it. */
  cellEntities: Map<number, MapEntity[]>;
  /** Wall-clock `Date.now()` this seed's session started, reset by the caller whenever `seed` changes. */
  sessionStartRef: MutableRefObject<number>;
  /**
   * Which robot is escorting each "found" survivor, written here (once, the
   * moment a survivor's fog cell first crosses the reveal threshold) and
   * read every frame by SurvivorMarker to drive its trailing position. A
   * plain ref, never React state - see robots.ts/SurvivorEscortMap's docs.
   */
  escortRef: MutableRefObject<SurvivorEscortMap>;
  onTelemetryUpdate?: (snapshot: TelemetrySnapshot) => void;
}

export default function TelemetryTracker({
  map,
  robots,
  fog,
  positionsRef,
  commsStateRef,
  cellEntities,
  sessionStartRef,
  escortRef,
  onTelemetryUpdate,
}: TelemetryTrackerProps) {
  const fogIdentityRef = useRef<FogOfWarState | null>(null);
  const loggedCellsRef = useRef<Uint8Array>(new Uint8Array(0));
  const foundSurvivorIdsRef = useRef<Set<string>>(new Set());
  const pendingFeedRef = useRef<FeedEntry[]>([]);
  const feedSeqRef = useRef(0);
  const lastFlushRef = useRef(0);

  useFrame(() => {
    // `fog` is a brand-new object every time the seed regenerates (see
    // DisasterMap3D's useMemo), so an identity check here is all we need
    // to detect "this is a fresh session" and reset every accumulator.
    // Refs may only be read/written outside of render - useFrame's
    // callback runs on every animation frame, well outside React's render
    // phase, so this check lives here rather than in the component body.
    if (fogIdentityRef.current !== fog) {
      fogIdentityRef.current = fog;
      loggedCellsRef.current = new Uint8Array(fog.resolution * fog.resolution);
      foundSurvivorIdsRef.current = new Set();
      pendingFeedRef.current = [];
      escortRef.current = {};
    }

    if (!onTelemetryUpdate) return;

    const { explored, resolution } = fog;
    const logged = loggedCellsRef.current;
    const cellCount = resolution * resolution;
    const nowMs = Date.now();
    const elapsedSeconds = Math.max(0, (nowMs - sessionStartRef.current) / 1000);

    for (let idx = 0; idx < cellCount; idx++) {
      if (logged[idx]) continue;
      if (explored[idx] < REVEAL_LOG_THRESHOLD) continue;
      logged[idx] = 1;

      const entitiesHere = cellEntities.get(idx);
      if (!entitiesHere || entitiesHere.length === 0) continue;

      for (const entity of entitiesHere) {
        let nearestRobot = robots[0];
        let bestDist = Infinity;
        for (const r of robots) {
          const p = positionsRef.current[r.id];
          if (!p) continue;
          const d = Math.hypot(p.x - entity.position[0], p.z - entity.position[2]);
          if (d < bestDist) {
            bestDist = d;
            nearestRobot = r;
          }
        }
        const nearestId = nearestRobot?.id ?? "robot-0";
        const channelLabel = nearestRobot?.channelLabel ?? "CH-1";

        if (entity.type === "survivor") {
          foundSurvivorIdsRef.current.add(entity.id);
          // Stick with whichever robot was nearest at the moment of
          // discovery as the permanent "escort" - no dynamic re-assignment,
          // per the spec (keeps SurvivorMarker's trailing behavior simple).
          escortRef.current[entity.id] = nearestId;
        }

        pendingFeedRef.current.push(
          makeFeedEntry(entity, nearestId, channelLabel, elapsedSeconds, feedSeqRef.current++)
        );
      }
    }

    if (nowMs - lastFlushRef.current < FLUSH_INTERVAL_MS) return;
    lastFlushRef.current = nowMs;

    const robotsTelemetry = robots.map((r) =>
      computeRobotTelemetry(
        r,
        positionsRef.current[r.id],
        map,
        elapsedSeconds,
        commsStateRef.current[r.id] ?? "green"
      )
    );
    const newFeedEntries = pendingFeedRef.current;
    pendingFeedRef.current = [];

    onTelemetryUpdate({
      elapsedSeconds,
      survivorsFound: foundSurvivorIdsRef.current.size,
      survivorsTotal: map.survivors.length,
      robots: robotsTelemetry,
      newFeedEntries,
    });
  });

  return null;
}
