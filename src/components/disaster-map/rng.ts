/**
 * Deterministic PRNG utilities for the disaster map generator.
 *
 * A seed *string* (e.g. "QUAKE-7821") is hashed down to a 32-bit
 * unsigned integer using an FNV-1a style hash, then that integer
 * seeds a mulberry32 PRNG. The same seed string will always produce
 * the exact same integer, and the exact same stream of "random"
 * numbers, which is what lets the terrain and the ruined city agree
 * on a single deterministic layout.
 */

/** Hash an arbitrary string into a 32-bit unsigned integer seed. */
export function hashStringToSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  // final avalanche mix
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

/** mulberry32 - small, fast, deterministic 32-bit PRNG. */
export function mulberry32(seedInt: number): () => number {
  let a = seedInt >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SeededRNG {
  /** The integer seed derived from the original seed string. */
  seedInt: number;
  /** Raw uniform float in [0, 1). */
  next: () => number;
  /** Uniform float in [min, max). */
  range: (min: number, max: number) => number;
  /** Uniform integer in [min, max] (inclusive). */
  int: (min: number, max: number) => number;
  /** Uniform pick from an array. */
  pick: <T>(arr: readonly T[]) => T;
  /** Bernoulli trial, true with probability p. */
  bool: (p?: number) => boolean;
  /** Signed float in [-1, 1). */
  signed: () => number;
}

/** Build a full deterministic RNG helper from a seed string. */
export function createSeededRNG(seed: string): SeededRNG {
  const seedInt = hashStringToSeed(seed);
  const next = mulberry32(seedInt);
  const range = (min: number, max: number) => min + next() * (max - min);
  return {
    seedInt,
    next,
    range,
    int: (min: number, max: number) => Math.floor(range(min, max + 1)),
    pick: <T,>(arr: readonly T[]) => arr[Math.floor(next() * arr.length)],
    bool: (p = 0.5) => next() < p,
    signed: () => next() * 2 - 1,
  };
}
