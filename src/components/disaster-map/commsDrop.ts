/**
 * Pure logic backing each rescue robot's simulated comms-link health: a
 * smooth, organic-looking "signal quality" wobble (same two-sine-wobble
 * technique as `useCommsStability`, just seeded per-robot off its id via
 * `hashStringToSeed` instead of the mission seed) mapped to a discrete
 * green/amber/red state through a small hysteresis/dwell-time state
 * machine so it never flickers right at a threshold boundary.
 *
 * This is a genuinely *runtime* signal (driven by live elapsed time, not
 * the deterministic map seed), computed every frame purely from refs in
 * DisasterMap3D.tsx's RobotUnit - never Math.random(), never React state.
 * Nothing in this file touches Three.js or React, matching the existing
 * telemetry.ts / generateDisasterMap.ts split of "pure logic in its own
 * file, Fiber/Three wiring elsewhere".
 */

import { hashStringToSeed } from "./rng";

export type CommsLinkState = "green" | "amber" | "red";

/** Live per-robot comms state, keyed by robot id - written every frame by RobotUnit, read by CommsLink/TelemetryTracker. */
export type RobotCommsStates = Record<string, CommsLinkState>;

/** Quality above this is "green" (nominal link). */
export const COMMS_GREEN_THRESHOLD = 0.7;
/** Quality below this is "red" (disconnected). Between the two thresholds is "amber" (degraded/packet loss). */
export const COMMS_RED_THRESHOLD = 0.3;
/** Minimum time (seconds) the underlying quality must stay past a threshold before the discrete state actually switches - prevents rapid flicker right at the boundary. */
export const COMMS_STATE_DWELL_SECONDS = 1.2;

export interface CommsDropPhase {
  a: number;
  b: number;
}

/** Deterministic (not Math.random) pair of wobble phases for one robot, derived from its id so every robot's comms "personality" differs. */
export function commsDropPhaseForRobot(robotId: string): CommsDropPhase {
  const ha = hashStringToSeed(`${robotId}::comms-drop-a`);
  const hb = hashStringToSeed(`${robotId}::comms-drop-b`);
  return {
    a: ((ha % 1000) / 1000) * Math.PI * 2,
    b: ((hb % 1000) / 1000) * Math.PI * 2,
  };
}

const WOBBLE_FREQ_A = 0.045;
const WOBBLE_FREQ_B = 0.12;
const WOBBLE_AMPLITUDE_A = 0.5;
const WOBBLE_AMPLITUDE_B = 0.32;

/**
 * Smooth 0..1 "comms quality" signal at a given elapsed time. Two slow,
 * independent sine waves combine into a gently drifting curve that spends
 * most of its time mid-range but organically dips below
 * `COMMS_RED_THRESHOLD` and rises above `COMMS_GREEN_THRESHOLD` every so
 * often - never an instant jump, always a smooth ramp.
 */
export function commsQualityAt(elapsedSeconds: number, phase: CommsDropPhase): number {
  const wobble =
    Math.sin(elapsedSeconds * WOBBLE_FREQ_A + phase.a) * WOBBLE_AMPLITUDE_A +
    Math.sin(elapsedSeconds * WOBBLE_FREQ_B + phase.b) * WOBBLE_AMPLITUDE_B;
  return Math.min(1, Math.max(0, 0.5 + wobble * 0.6));
}

function stateForQuality(quality: number): CommsLinkState {
  if (quality > COMMS_GREEN_THRESHOLD) return "green";
  if (quality < COMMS_RED_THRESHOLD) return "red";
  return "amber";
}

/**
 * Mutable per-robot hysteresis tracker (held in a ref, one per RobotUnit
 * instance - never React state). `updateCommsDropTracker` only commits a
 * new discrete state once the instantaneous quality has favored that state
 * continuously for `COMMS_STATE_DWELL_SECONDS`, so a value oscillating
 * right at a threshold reads as a steady state, not a flicker.
 */
export interface CommsDropTracker {
  state: CommsLinkState;
  pendingState: CommsLinkState | null;
  pendingSinceSeconds: number;
}

export function createCommsDropTracker(): CommsDropTracker {
  return { state: "green", pendingState: null, pendingSinceSeconds: 0 };
}

/** Advance one robot's hysteresis tracker given the latest instantaneous quality; returns the (possibly unchanged) committed discrete state. */
export function updateCommsDropTracker(
  tracker: CommsDropTracker,
  quality: number,
  elapsedSeconds: number
): CommsLinkState {
  const candidate = stateForQuality(quality);

  if (candidate === tracker.state) {
    tracker.pendingState = null;
    return tracker.state;
  }

  if (tracker.pendingState !== candidate) {
    tracker.pendingState = candidate;
    tracker.pendingSinceSeconds = elapsedSeconds;
    return tracker.state;
  }

  if (elapsedSeconds - tracker.pendingSinceSeconds >= COMMS_STATE_DWELL_SECONDS) {
    tracker.state = candidate;
    tracker.pendingState = null;
  }

  return tracker.state;
}
