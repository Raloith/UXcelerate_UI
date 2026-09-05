import { MAP_HALF, MAP_SIZE } from "./generateDisasterMap";
import { createSeededRNG } from "./rng";

/**
 * Fog-of-war grid: a coarse resolution x resolution lattice of cells laid
 * over the full MAP_SIZE x MAP_SIZE terrain. Each cell tracks an "explored"
 * amount in [0, 1] that only ever ramps up (permanent reveal, no re-fogging)
 * as rescue robots pass nearby - see `revealFogAround`.
 */
export const FOG_RESOLUTION = 40;
export const FOG_CELL_SIZE = MAP_SIZE / FOG_RESOLUTION;

/** Roughly how far (in meters) the initial pre-explored cluster reaches from each base. */
const INITIAL_REVEAL_RADIUS = 42;
/** Per-cell jitter on that radius so the starting cluster reads as an organic blob, not a perfect circle. */
const INITIAL_REVEAL_JITTER = 16;

export interface FogOfWarState {
  resolution: number;
  cellSize: number;
  /** Explored amount per cell, row-major as `explored[j * resolution + i]`, each in [0, 1]. */
  explored: Float32Array;
  /** Deterministic per-cell phase (0..2π) driving the idle "sensor static" flicker on unexplored cells. */
  phases: Float32Array;
}

/** World-space (x, z) center of fog cell (i, j). */
export function fogCellCenter(i: number, j: number): [number, number] {
  return [
    -MAP_HALF + (i + 0.5) * FOG_CELL_SIZE,
    -MAP_HALF + (j + 0.5) * FOG_CELL_SIZE,
  ];
}

/**
 * Reverse of `fogCellCenter`: which row-major cell index a world-space
 * (x, z) point falls into (clamped to the grid bounds). Used to build a
 * one-time reverse lookup from "fog cell" to "entities sitting in it", so
 * the HUD's reveal-event scan (see telemetry.ts) can check newly-revealed
 * cells against hazard/survivor positions in O(1) instead of re-scanning
 * every entity every frame.
 */
export function cellIndexForPosition(x: number, z: number): number {
  const i = Math.min(
    FOG_RESOLUTION - 1,
    Math.max(0, Math.floor((x + MAP_HALF) / FOG_CELL_SIZE))
  );
  const j = Math.min(
    FOG_RESOLUTION - 1,
    Math.max(0, Math.floor((z + MAP_HALF) / FOG_CELL_SIZE))
  );
  return j * FOG_RESOLUTION + i;
}

/**
 * Build the initial fog-of-war grid for a seed. Roughly 80% of the map
 * starts hidden; the rest is a deterministic, organic-edged cluster around
 * each given base coordinate (robots "already know" their home turf).
 * Uses its own derived RNG stream (`${seed}::fog`) so re-generating the
 * same seed always reproduces the same starting fog pattern.
 */
export function createFogOfWar(
  seed: string,
  baseCenters: Array<[number, number]>
): FogOfWarState {
  const rng = createSeededRNG(`${seed}::fog`);
  const res = FOG_RESOLUTION;
  const explored = new Float32Array(res * res);
  const phases = new Float32Array(res * res);

  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const idx = j * res + i;
      phases[idx] = rng.next() * Math.PI * 2;
      const jitter = (rng.next() - 0.5) * INITIAL_REVEAL_JITTER;

      const [x, z] = fogCellCenter(i, j);
      let revealed = false;
      for (const [bx, bz] of baseCenters) {
        if (Math.hypot(x - bx, z - bz) < INITIAL_REVEAL_RADIUS + jitter) {
          revealed = true;
          break;
        }
      }
      explored[idx] = revealed ? 1 : 0;
    }
  }

  return { resolution: res, cellSize: FOG_CELL_SIZE, explored, phases };
}

/**
 * Ramp explored amount toward 1 for every cell within `radius` meters of
 * (cx, cz). Framerate-independent exponential ease so clearing always looks
 * smooth (never an instant snap) regardless of frame rate; cells nearer the
 * center clear faster than cells near the radius edge. Never re-hides an
 * already-explored cell.
 */
export function revealFogAround(
  state: FogOfWarState,
  cx: number,
  cz: number,
  radius: number,
  dt: number,
  rate = 2.2
) {
  const { resolution, cellSize, explored } = state;
  if (radius <= 0 || dt <= 0) return;

  const minI = Math.max(0, Math.floor((cx + MAP_HALF - radius) / cellSize));
  const maxI = Math.min(resolution - 1, Math.ceil((cx + MAP_HALF + radius) / cellSize));
  const minJ = Math.max(0, Math.floor((cz + MAP_HALF - radius) / cellSize));
  const maxJ = Math.min(resolution - 1, Math.ceil((cz + MAP_HALF + radius) / cellSize));
  const easing = 1 - Math.exp(-dt * rate);

  for (let j = minJ; j <= maxJ; j++) {
    for (let i = minI; i <= maxI; i++) {
      const idx = j * resolution + i;
      const current = explored[idx];
      if (current >= 0.999) continue;
      const [x, z] = fogCellCenter(i, j);
      const d = Math.hypot(x - cx, z - cz);
      if (d > radius) continue;
      const falloff = Math.max(1 - d / radius, 0.15);
      explored[idx] = current + (1 - current) * easing * falloff;
    }
  }
}
