import { createSeededRNG, type SeededRNG } from "./rng";

/** Half-width of the square terrain, in meters. Full map is 200x200. */
export const MAP_SIZE = 200;
export const MAP_HALF = MAP_SIZE / 2;

export type EntityType =
  | "rubble"
  | "hazard"
  | "blocked-path"
  | "route"
  | "survivor";

/** Ground biomes, randomly scattered across the map from the same seed. */
export const BIOME_TYPES = ["sand", "plains", "swamp", "jungle"] as const;
export type BiomeType = (typeof BIOME_TYPES)[number];

export interface BiomeSample {
  /** The strongest biome influence at this point. */
  type: BiomeType;
  /** Normalized 0..1 blend weight per biome, sums to 1 - used for color mixing. */
  weights: Record<BiomeType, number>;
}

export interface BiomeCenter {
  x: number;
  z: number;
  radius: number;
  type: BiomeType;
}

export interface RubbleBox {
  /** Offset from the cluster's anchor point, in meters. */
  offset: [number, number];
  /** Width / height / depth of the broken masonry block. */
  size: [number, number, number];
  /** Rotation around Y, in radians. */
  rotationY: number;
  /** 0..1 tone variance so blocks in a pile don't look identical. */
  tone: number;
}

export interface MapEntity {
  id: string;
  type: EntityType;
  /** World-space [x, y, z] - y is the ground/anchor elevation. */
  position: [number, number, number];
  rotationY: number;
  metadata: Record<string, unknown>;
}

export interface Corridor {
  id: string;
  a: [number, number];
  b: [number, number];
  width: number;
}

export interface GeneratedDisasterMap {
  seed: string;
  seedInt: number;
  bounds: { size: number; half: number };
  corridors: Corridor[];
  /** Every generated entity, flattened. */
  entities: MapEntity[];
  /** Convenience buckets, all subsets of `entities`. */
  rubble: MapEntity[];
  hazards: MapEntity[];
  blockedPaths: MapEntity[];
  routes: MapEntity[];
  survivors: MapEntity[];
  /** Sample procedural terrain elevation at any world (x, z). */
  getElevation: (x: number, z: number) => number;
  /** Sample which biome(s) blend at any world (x, z). */
  getBiome: (x: number, z: number) => BiomeSample;
  /** The randomly-scattered biome region centers driving `getBiome`. */
  biomeCenters: BiomeCenter[];
  /** Map-wide biome summary, handy for a HUD legend. */
  biomes: { dominant: BiomeType; coverage: Record<BiomeType, number> };
}

// ---------------------------------------------------------------------------
// Seeded value-noise (deterministic, no external noise library required)
// ---------------------------------------------------------------------------

/** A square lattice of random values in [-1, 1], sampled with bilinear + smoothstep interpolation. */
function createNoiseGrid(rng: SeededRNG, resolution: number) {
  const size = resolution + 1;
  const lattice = new Float32Array(size * size);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng.signed();

  const smooth = (t: number) => t * t * (3 - 2 * t);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  /** Sample noise for normalized coordinates u, v in [0, 1]. */
  return function sample(u: number, v: number): number {
    const gx = Math.min(Math.max(u, 0), 1) * resolution;
    const gy = Math.min(Math.max(v, 0), 1) * resolution;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const x1 = Math.min(x0 + 1, resolution);
    const y1 = Math.min(y0 + 1, resolution);
    const sx = smooth(gx - x0);
    const sy = smooth(gy - y0);

    const n00 = lattice[y0 * size + x0];
    const n10 = lattice[y0 * size + x1];
    const n01 = lattice[y1 * size + x0];
    const n11 = lattice[y1 * size + x1];

    const ix0 = lerp(n00, n10, sx);
    const ix1 = lerp(n01, n11, sx);
    return lerp(ix0, ix1, sy);
  };
}

function distanceToSegment(
  px: number,
  pz: number,
  a: [number, number],
  b: [number, number]
) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const lengthSq = dx * dx + dz * dz || 1e-6;
  let t = ((px - a[0]) * dx + (pz - a[1]) * dz) / lengthSq;
  t = Math.min(1, Math.max(0, t));
  const cx = a[0] + t * dx;
  const cz = a[1] + t * dz;
  return Math.hypot(px - cx, pz - cz);
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

/**
 * Generate a fully deterministic disaster-site map (terrain + ruined city
 * entities) from a seed string. Calling this twice with the same seed
 * always produces identical terrain and identical entity coordinates,
 * because everything is pulled from a single sequential RNG stream.
 */
export function generateDisasterMap(seed: string): GeneratedDisasterMap {
  const rng = createSeededRNG(seed);

  // --- Terrain: layered seeded value-noise -------------------------------
  // Consumed first from the stream, then city placement continues below.
  const rollingNoise = createNoiseGrid(rng, 18); // broad elevation swells
  const crackNoise = createNoiseGrid(rng, 48); // thin sharp cracks
  const detailNoise = createNoiseGrid(rng, 96); // fine surface roughness

  const BUMP_COUNT = rng.int(50, 70);
  const bumps = Array.from({ length: BUMP_COUNT }, () => ({
    x: rng.range(-MAP_HALF, MAP_HALF),
    z: rng.range(-MAP_HALF, MAP_HALF),
    radius: rng.range(2, 7),
    height: rng.range(0.25, 1.4) * (rng.bool(0.25) ? -1 : 1), // craters vs displaced slabs
  }));

  // --- Biomes: seed-driven sandy / plains / swamp / jungle patches --------
  // A handful of soft, overlapping "region" blobs are scattered across the
  // map. Each point blends the regions near it (smoothstep falloff) so the
  // borders feel organic instead of hard-edged tiles.
  const biomeDetailNoise = createNoiseGrid(rng, 30); // dunes / undergrowth bumps
  const biomeCenterCount = rng.int(6, 10);
  const biomeCenters: BiomeCenter[] = Array.from({ length: biomeCenterCount }, () => ({
    x: rng.range(-MAP_HALF * 0.9, MAP_HALF * 0.9),
    z: rng.range(-MAP_HALF * 0.9, MAP_HALF * 0.9),
    radius: rng.range(28, 60),
    type: rng.pick(BIOME_TYPES),
  }));

  function getBiome(x: number, z: number): BiomeSample {
    const raw: Record<BiomeType, number> = { sand: 0, plains: 0.15, swamp: 0, jungle: 0 };
    for (const c of biomeCenters) {
      const d = Math.hypot(x - c.x, z - c.z);
      const t = Math.max(0, 1 - d / (c.radius * 1.5));
      raw[c.type] += t * t * (3 - 2 * t); // smoothstep falloff, blends overlaps
    }
    const total = BIOME_TYPES.reduce((sum, t) => sum + raw[t], 0) || 1;
    const weights = Object.fromEntries(
      BIOME_TYPES.map((t) => [t, raw[t] / total])
    ) as Record<BiomeType, number>;

    let type: BiomeType = "plains";
    let best = -Infinity;
    for (const t of BIOME_TYPES) {
      if (weights[t] > best) {
        best = weights[t];
        type = t;
      }
    }
    return { type, weights };
  }

  function getElevation(x: number, z: number): number {
    const u = (x + MAP_HALF) / MAP_SIZE;
    const v = (z + MAP_HALF) / MAP_SIZE;

    let h = rollingNoise(u, v) * 1.6; // broad rolling elevation
    h += detailNoise(u * 3, v * 3) * 0.25; // fine roughness

    // Cracks: thin ridged depressions carved into the ground.
    const ridge = 1 - Math.abs(crackNoise(u * 2, v * 2));
    const crack = Math.pow(Math.max(ridge, 0), 10);
    h -= crack * 1.1;

    // Localized displacement: heaved/cratered asphalt chunks.
    for (const b of bumps) {
      const d = Math.hypot(x - b.x, z - b.z);
      if (d < b.radius) {
        const t = 1 - d / b.radius;
        h += b.height * t * t * (3 - 2 * t);
      }
    }

    // Biome character: dunes in sand, dense undergrowth bumps in jungle,
    // and flat waterlogged low ground in swamp.
    const { weights } = getBiome(x, z);
    h += weights.sand * biomeDetailNoise(u * 1.6, v * 1.6) * 1.1;
    h += weights.jungle * biomeDetailNoise(u * 4, v * 4) * 0.6;
    h *= 1 - weights.swamp * 0.55;
    h -= weights.swamp * 0.45;

    return h;
  }

  function summarizeBiomes() {
    const counts: Record<BiomeType, number> = { sand: 0, plains: 0, swamp: 0, jungle: 0 };
    const samples = 24;
    for (let i = 0; i < samples; i++) {
      for (let j = 0; j < samples; j++) {
        const x = -MAP_HALF + (i + 0.5) * (MAP_SIZE / samples);
        const z = -MAP_HALF + (j + 0.5) * (MAP_SIZE / samples);
        counts[getBiome(x, z).type]++;
      }
    }
    const total = samples * samples;
    const coverage = Object.fromEntries(
      BIOME_TYPES.map((t) => [t, counts[t] / total])
    ) as Record<BiomeType, number>;
    let dominant: BiomeType = "plains";
    let best = -1;
    for (const t of BIOME_TYPES) {
      if (counts[t] > best) {
        best = counts[t];
        dominant = t;
      }
    }
    return { dominant, coverage };
  }

  // --- Corridors (accessible route skeleton) -----------------------------
  const corridors: Corridor[] = [
    { id: "corridor-ns", a: [0, -MAP_HALF], b: [0, MAP_HALF], width: 16 },
    { id: "corridor-ew", a: [-MAP_HALF, 0], b: [MAP_HALF, 0], width: 16 },
  ];
  const diagonalAngles = [Math.PI / 6, Math.PI / 3, (2 * Math.PI) / 3];
  const diagonalCount = rng.int(1, 2);
  for (let i = 0; i < diagonalCount; i++) {
    const angle = rng.pick(diagonalAngles);
    const offset = rng.range(-30, 30);
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const cx = -dz * offset;
    const cz = dx * offset;
    const reach = MAP_HALF * 1.05;
    corridors.push({
      id: `corridor-diag-${i}`,
      a: [cx - dx * reach, cz - dz * reach],
      b: [cx + dx * reach, cz + dz * reach],
      width: 10,
    });
  }

  const distanceToCorridors = (x: number, z: number) =>
    Math.min(...corridors.map((c) => distanceToSegment(x, z, c.a, c.b)));

  // --- Entity placement ----------------------------------------------------
  const entities: MapEntity[] = [];
  const rubble: MapEntity[] = [];
  const hazards: MapEntity[] = [];
  const blockedPaths: MapEntity[] = [];
  const routes: MapEntity[] = [];
  const survivors: MapEntity[] = [];

  const EDGE_MARGIN = 6;
  const MIN_SPACING = 8;
  const placedCenters: Array<[number, number]> = [];

  const tooClose = (x: number, z: number, spacing: number) =>
    placedCenters.some(([px, pz]) => Math.hypot(x - px, z - pz) < spacing);

  function makeRubbleBoxes(footprint: number): RubbleBox[] {
    const boxCount = rng.int(2, 4);
    const boxes: RubbleBox[] = [];
    for (let i = 0; i < boxCount; i++) {
      boxes.push({
        offset: [rng.range(-footprint, footprint), rng.range(-footprint, footprint)],
        size: [
          rng.range(1.5, 4.5),
          rng.range(0.8, 5.5),
          rng.range(1.5, 4.5),
        ],
        rotationY: rng.range(-0.5, 0.5) + rng.pick([0, Math.PI / 2, Math.PI]),
        tone: rng.next(),
      });
    }
    return boxes;
  }

  // 1) Blocked paths: a few large rubble piles deliberately dumped across
  //    corridors, forcing the rescue team to route around them.
  const blockCount = rng.int(3, 5);
  let blockAttempts = 0;
  let blocksPlaced = 0;
  while (blocksPlaced < blockCount && blockAttempts < 40) {
    blockAttempts++;
    const corridor = rng.pick(corridors);
    const t = rng.range(0.18, 0.82);
    const x = corridor.a[0] + (corridor.b[0] - corridor.a[0]) * t;
    const z = corridor.a[1] + (corridor.b[1] - corridor.a[1]) * t;
    if (tooClose(x, z, MIN_SPACING * 1.5)) continue;
    const footprint = rng.range(3, 5);
    const id = `blocked-path-${blocksPlaced}`;
    blockedPaths.push({
      id,
      type: "blocked-path",
      position: [x, getElevation(x, z), z],
      rotationY: rng.range(0, Math.PI * 2),
      metadata: {
        corridorId: corridor.id,
        footprint,
        boxes: makeRubbleBoxes(footprint),
        severity: rng.pick(["moderate", "severe"] as const),
      },
    });
    placedCenters.push([x, z]);
    blocksPlaced++;
  }

  // 2) General rubble/rubble field: scattered ruined-city blocks that
  //    intentionally avoid the corridor lanes, so clear routes emerge
  //    naturally as the negative space between rubble.
  const rubbleTarget = rng.int(30, 42);
  let rubbleAttempts = 0;
  let rubblePlaced = 0;
  const CLEARANCE = 3;
  while (rubblePlaced < rubbleTarget && rubbleAttempts < rubbleTarget * 12) {
    rubbleAttempts++;
    const x = rng.range(-MAP_HALF + EDGE_MARGIN, MAP_HALF - EDGE_MARGIN);
    const z = rng.range(-MAP_HALF + EDGE_MARGIN, MAP_HALF - EDGE_MARGIN);
    const nearestCorridor = distanceToCorridors(x, z);
    const requiredClearance =
      corridors.find((c) => distanceToSegment(x, z, c.a, c.b) === nearestCorridor)
        ?.width ?? 16;
    if (nearestCorridor < requiredClearance / 2 + CLEARANCE) continue;
    if (tooClose(x, z, MIN_SPACING)) continue;

    const footprint = rng.range(1.5, 4);
    const height = rng.range(1, 9);
    const isUnstable = rng.bool(0.22);
    const id = `rubble-${rubblePlaced}`;

    const entity: MapEntity = {
      id,
      type: "rubble",
      position: [x, getElevation(x, z), z],
      rotationY: rng.range(0, Math.PI * 2),
      metadata: {
        footprint,
        height,
        boxes: makeRubbleBoxes(footprint),
        unstable: isUnstable,
      },
    };
    rubble.push(entity);
    placedCenters.push([x, z]);
    rubblePlaced++;

    if (isUnstable) {
      hazards.push({
        id: `hazard-${id}`,
        type: "hazard",
        position: [x, getElevation(x, z) + height * 0.5 + 0.5, z],
        rotationY: rng.range(0, Math.PI * 2),
        metadata: {
          sourceRubbleId: id,
          style: rng.pick(["ember", "wireframe"] as const),
          severity: rng.pick(["warning", "critical"] as const),
        },
      });
    }
  }

  // 3) Accessible routes: sampled waypoints along each clear corridor,
  //    ground-fitted so overlays / pathing can hug the real terrain.
  corridors.forEach((corridor, corridorIndex) => {
    const steps = 9;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = corridor.a[0] + (corridor.b[0] - corridor.a[0]) * t;
      const z = corridor.a[1] + (corridor.b[1] - corridor.a[1]) * t;
      routes.push({
        id: `route-${corridorIndex}-${i}`,
        type: "route",
        position: [x, getElevation(x, z) + 0.05, z],
        rotationY: 0,
        metadata: { corridorId: corridor.id, order: i, width: corridor.width },
      });
    }
  });

  // 4) Survivors: 5-15 hidden ground-level targets, biased to be trapped
  //    near rubble clusters (but not required to be, for variety).
  const survivorCount = rng.int(5, 15);
  const sourcePool = [...rubble, ...blockedPaths];
  for (let i = 0; i < survivorCount; i++) {
    let x: number;
    let z: number;
    if (sourcePool.length > 0 && rng.bool(0.75)) {
      const source = rng.pick(sourcePool);
      x = source.position[0] + rng.range(-3.5, 3.5);
      z = source.position[2] + rng.range(-3.5, 3.5);
    } else {
      x = rng.range(-MAP_HALF + EDGE_MARGIN, MAP_HALF - EDGE_MARGIN);
      z = rng.range(-MAP_HALF + EDGE_MARGIN, MAP_HALF - EDGE_MARGIN);
    }
    x = Math.min(MAP_HALF - EDGE_MARGIN, Math.max(-MAP_HALF + EDGE_MARGIN, x));
    z = Math.min(MAP_HALF - EDGE_MARGIN, Math.max(-MAP_HALF + EDGE_MARGIN, z));

    survivors.push({
      id: `survivor-${i}`,
      type: "survivor",
      position: [x, getElevation(x, z), z],
      rotationY: 0,
      metadata: {
        status: rng.pick(["critical", "injured", "stable"] as const),
        signalStrength: rng.range(0.4, 1),
        phase: rng.next() * Math.PI * 2,
      },
    });
  }

  entities.push(...rubble, ...blockedPaths, ...hazards, ...routes, ...survivors);

  return {
    seed,
    seedInt: rng.seedInt,
    bounds: { size: MAP_SIZE, half: MAP_HALF },
    corridors,
    entities,
    rubble,
    hazards,
    blockedPaths,
    routes,
    survivors,
    getElevation,
    getBiome,
    biomeCenters,
    biomes: summarizeBiomes(),
  };
}

export const DEFAULT_SEED = "QUAKE-7821";
