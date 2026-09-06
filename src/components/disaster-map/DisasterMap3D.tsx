"use client";

import { useEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import * as THREE from "three";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import type { Line2, OrbitControls as OrbitControlsImpl } from "three-stdlib";

import {
  BIOME_TYPES,
  DEFAULT_SEED,
  MAP_HALF,
  MAP_SIZE,
  generateDisasterMap,
  type BiomeType,
  type GeneratedDisasterMap,
  type MapEntity,
} from "./generateDisasterMap";
import { hashStringToSeed } from "./rng";
import {
  FOG_CELL_SIZE,
  cellIndexForPosition,
  createFogOfWar,
  revealFogAround,
  fogCellCenter,
  type FogOfWarState,
} from "./fogOfWar";
import { generateRobots, sampleRobotPosition, type RescueRobot } from "./robots";
import TelemetryTracker from "./TelemetryTracker";
import type { RobotPositions, SurvivorEscortMap, TelemetrySnapshot } from "./telemetry";
import {
  commsDropPhaseForRobot,
  commsQualityAt,
  createCommsDropTracker,
  updateCommsDropTracker,
  type CommsLinkState,
  type RobotCommsStates,
} from "./commsDrop";

/** Deterministic 0..1 float derived from a string id (no Math.random). */
function phaseFromId(id: string): number {
  return (hashStringToSeed(id) % 1000) / 1000;
}

/**
 * Live 3D object refs for each robot, keyed by robot id - registered once
 * (in an effect, not per-frame) by RobotUnit, then read every frame by
 * CommsLinks/SurvivorMarker to draw comms links / drive escort trailing
 * off the robot's actual rendered position without touching React state.
 */
type RobotObjectRefs = Record<string, THREE.Object3D | null>;

export {
  generateDisasterMap,
  DEFAULT_SEED,
  MAP_SIZE,
  MAP_HALF,
  BIOME_TYPES,
  type GeneratedDisasterMap,
  type MapEntity,
  type EntityType,
  type BiomeType,
  type BiomeSample,
} from "./generateDisasterMap";
export type { RescueRobot } from "./robots";
export type {
  FeedEntry,
  FeedKind,
  FeedSeverity,
  QueuedCommand,
  QueuedCommandKind,
  RobotTask,
  RobotTelemetry,
  TelemetrySnapshot,
} from "./telemetry";
export { CANNED_COMMANDS, makeCommandExecutedFeedEntry } from "./telemetry";
export type { CommsLinkState } from "./commsDrop";

// ---------------------------------------------------------------------------
// Palette - colorful biomes, still dark & technical at the edges/hazards
// ---------------------------------------------------------------------------

const PALETTE = {
  rubbleA: "#6b6154",
  rubbleB: "#847a64",
  rubbleBlocked: "#8a6146",
  route: "#38f2ff",
  /** Tactical comms-link tint - violet/magenta, distinct from route-cyan and hazard-orange. */
  commsLink: "#b58bff",
  survivor: "#3dffb0",
  survivorCritical: "#ff5a4d",
  hazardEmber: "#ff7a1a",
  hazardWire: "#ffcf3f",
  fog: "#241f16",
  sun: "#fff2c9",
  sunHalo: "#ffcf6b",
  fogOfWar: "#070a10",
  fogOfWarStatic: "#3d5568",
  robotRing: "#38f2ff",
  /** Comms-link health tones - shared with the HUD's LINK: NOMINAL/DEGRADED/LOST styling (emerald/amber/rose). */
  commsNominal: "#34d399",
  commsDegraded: "#fbbf24",
  commsLost: "#fb7185",
} as const;

/**
 * Precomputed once at module scope (pure, no React/Fiber involved) - the
 * "broken link" tint colors used to blend a robot's body material and its
 * CommsLink beams toward amber/red as comms degrade, and the stale-trail
 * line's color while a robot is amber/red. Kept as module-level `THREE.Color`
 * instances (like PALETTE's own hex strings) rather than re-allocating a new
 * Color every frame per robot.
 */
const COMMS_TINT_AMBER = new THREE.Color(PALETTE.commsDegraded);
const COMMS_TINT_RED = new THREE.Color(PALETTE.commsLost);
const COMMS_LINK_COLOR_AMBER = new THREE.Color(PALETTE.commsLink).lerp(
  new THREE.Color(PALETTE.commsDegraded),
  0.55
);
const COMMS_LINK_COLOR_RED = new THREE.Color(PALETTE.commsLink).lerp(
  new THREE.Color(PALETTE.commsLost),
  0.7
);

/** Base ground color per biome (low elevation / shaded). */
const BIOME_COLOR: Record<BiomeType, string> = {
  sand: "#c9a561",
  plains: "#5f7a3f",
  swamp: "#3d4a34",
  jungle: "#254d30",
};

/** Highlight ground color per biome (high elevation / sunlit). */
const BIOME_HIGHLIGHT: Record<BiomeType, string> = {
  sand: "#f0d99a",
  plains: "#9dbb68",
  swamp: "#697a4d",
  jungle: "#4a9a58",
};

const CRACK_COLOR = "#140f08";

/**
 * Two related-but-separate positions:
 * - SUN_LIGHT_POSITION drives the actual directional key light, chosen for
 *   flattering shadows on this top-down camera (same side as the camera,
 *   just higher up, so faces toward the viewer stay lit).
 * - SUN_MESH_POSITION is purely where the decorative glowing sphere sits,
 *   chosen so it's actually visible in the thin sky strip this top-down
 *   camera shows (up and toward the far side of the map from the camera).
 * They don't need to physically match - the sun sphere is "just for show".
 */
const SUN_LIGHT_POSITION: [number, number, number] = [110, 130, 90];
// Verified against the live camera's actual view/projection matrices (this
// top-down frustum is narrow, and naive "far away and high up" guesses land
// behind the camera) to sit just right of top-center, clear of the HUD panel.
const SUN_MESH_POSITION: [number, number, number] = [35, 55, -5];
const SUN_RADIUS = 7;

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

function Terrain({ map }: { map: GeneratedDisasterMap }) {
  const geometry = useMemo(() => {
    const segments = 140;
    const geo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, segments, segments);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);

    const baseByBiome = Object.fromEntries(
      BIOME_TYPES.map((t) => [t, new THREE.Color(BIOME_COLOR[t])])
    ) as Record<BiomeType, THREE.Color>;
    const highByBiome = Object.fromEntries(
      BIOME_TYPES.map((t) => [t, new THREE.Color(BIOME_HIGHLIGHT[t])])
    ) as Record<BiomeType, THREE.Color>;
    const crack = new THREE.Color(CRACK_COLOR);

    const base = new THREE.Color();
    const high = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = map.getElevation(x, z);
      pos.setY(i, h);

      // Blend this point's ground/highlight color from every biome's weight,
      // so region borders fade smoothly instead of snapping between biomes.
      const { weights } = map.getBiome(x, z);
      base.setRGB(0, 0, 0);
      high.setRGB(0, 0, 0);
      for (const t of BIOME_TYPES) {
        const w = weights[t];
        if (w <= 0) continue;
        base.r += baseByBiome[t].r * w;
        base.g += baseByBiome[t].g * w;
        base.b += baseByBiome[t].b * w;
        high.r += highByBiome[t].r * w;
        high.g += highByBiome[t].g * w;
        high.b += highByBiome[t].b * w;
      }

      const elevT = THREE.MathUtils.clamp((h + 1.2) / 2.6, 0, 1);
      const c = base.clone().lerp(high, elevT);
      if (h < -0.55) c.lerp(crack, 0.55);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }, [map]);

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial
        vertexColors
        roughness={0.92}
        metalness={0.03}
        flatShading={false}
      />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Rubble / ruined-city blocks (shared by "rubble" and "blocked-path" types)
// ---------------------------------------------------------------------------

function RubblePile({
  entity,
  map,
  blocked,
}: {
  entity: MapEntity;
  map: GeneratedDisasterMap;
  blocked?: boolean;
}) {
  const boxes = (entity.metadata.boxes ?? []) as Array<{
    offset: [number, number];
    size: [number, number, number];
    rotationY: number;
    tone: number;
  }>;
  const baseColor = useMemo(
    () => new THREE.Color(blocked ? PALETTE.rubbleBlocked : PALETTE.rubbleA),
    [blocked]
  );
  const altColor = useMemo(() => new THREE.Color(PALETTE.rubbleB), []);
  // Tint the masonry toward the biome it's sitting in, so sandy rubble reads
  // as sun-bleached stone, jungle rubble as moss-covered, etc.
  const biomeTint = useMemo(() => {
    const { type } = map.getBiome(entity.position[0], entity.position[2]);
    return new THREE.Color(BIOME_COLOR[type]);
  }, [map, entity.position]);

  return (
    <group
      position={entity.position}
      rotation={[0, entity.rotationY, 0]}
      userData={{ entityId: entity.id, entityType: entity.type }}
    >
      {boxes.map((box, i) => {
        const color = baseColor.clone().lerp(altColor, box.tone).lerp(biomeTint, 0.24);
        return (
          <mesh
            key={i}
            position={[box.offset[0], box.size[1] / 2, box.offset[1]]}
            rotation={[
              box.tone > 0.7 ? 0.12 * (box.tone - 0.7) : 0,
              box.rotationY,
              box.tone < 0.3 ? 0.1 * (0.3 - box.tone) : 0,
            ]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={box.size} />
            <meshStandardMaterial color={color} roughness={0.92} metalness={0.08} />
          </mesh>
        );
      })}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Hazard markers - unstable structures (fiery embers or warning wireframes)
// ---------------------------------------------------------------------------

function HazardMarker({ entity }: { entity: MapEntity }) {
  const style = entity.metadata.style as "ember" | "wireframe";
  const emberRef = useRef<THREE.Mesh>(null);
  const wireRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const phase = useMemo(() => phaseFromId(entity.id) * Math.PI * 2, [entity.id]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() * 2.4 + phase;
    const pulse = 0.55 + Math.sin(t) * 0.45;
    if (emberRef.current) {
      const mat = emberRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 1.2 + pulse * 1.8;
      emberRef.current.scale.setScalar(0.85 + pulse * 0.2);
    }
    if (wireRef.current) {
      wireRef.current.rotation.y += 0.01;
      wireRef.current.scale.setScalar(0.9 + pulse * 0.15);
    }
    if (lightRef.current) {
      lightRef.current.intensity = 3 + pulse * 6;
    }
  });

  if (style === "ember") {
    return (
      <group position={entity.position}>
        <mesh ref={emberRef}>
          <icosahedronGeometry args={[0.55, 1]} />
          <meshStandardMaterial
            color={PALETTE.hazardEmber}
            emissive={PALETTE.hazardEmber}
            emissiveIntensity={2}
            roughness={0.4}
          />
        </mesh>
        <pointLight
          ref={lightRef}
          color={PALETTE.hazardEmber}
          intensity={5}
          distance={9}
          decay={2}
        />
      </group>
    );
  }

  return (
    <group position={entity.position}>
      <mesh ref={wireRef}>
        <coneGeometry args={[0.7, 1.4, 4]} />
        <meshBasicMaterial color={PALETTE.hazardWire} wireframe />
      </mesh>
      <pointLight
        ref={lightRef}
        color={PALETTE.hazardWire}
        intensity={3}
        distance={7}
        decay={2}
      />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Accessible routes - glowing corridor lines through the rubble
// ---------------------------------------------------------------------------

function RouteLines({ map }: { map: GeneratedDisasterMap }) {
  const byCorridor = useMemo(() => {
    const grouped = new Map<string, MapEntity[]>();
    for (const r of map.routes) {
      const key = r.metadata.corridorId as string;
      const arr = grouped.get(key) ?? [];
      arr.push(r);
      grouped.set(key, arr);
    }
    for (const arr of grouped.values()) {
      arr.sort((a, b) => (a.metadata.order as number) - (b.metadata.order as number));
    }
    return grouped;
  }, [map]);

  return (
    <group>
      {Array.from(byCorridor.entries()).map(([corridorId, points]) => (
        <Line
          key={corridorId}
          points={points.map((p) => [p.position[0], p.position[1] + 0.06, p.position[2]] as [number, number, number])}
          color={PALETTE.route}
          lineWidth={2}
          transparent
          opacity={0.55}
          dashed={false}
        />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Survivors - pulsing beacon markers pinned at ground level. Once "found"
// (fog cell revealed - see TelemetryTracker's escortRef assignment), the
// marker smoothly trails a couple meters off its escorting robot's live
// position instead of staying pinned at its original spawn coordinate, as
// if the robot is walking it out. Escort lookup + position blending is all
// plain ref reads/writes inside useFrame - no React state, no re-renders.
// ---------------------------------------------------------------------------

/** How far (in meters) a rescued survivor trails beside/behind its escort robot. */
const ESCORT_OFFSET_DISTANCE = 2.1;
/** Exponential-ease rate for the trailing lerp - same framerate-independent style as revealFogAround. */
const ESCORT_LERP_RATE = 2.4;

function SurvivorMarker({
  entity,
  escortRef,
  robotObjectsRef,
}: {
  entity: MapEntity;
  escortRef: MutableRefObject<SurvivorEscortMap>;
  robotObjectsRef: MutableRefObject<RobotObjectRefs>;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const phase = entity.metadata.phase as number;
  const critical = entity.metadata.status === "critical";
  const color = critical ? PALETTE.survivorCritical : PALETTE.survivor;
  // Fixed per-survivor angle around its escort robot, so several rescued
  // survivors escorted by the same robot fan out instead of overlapping.
  const escortOffset = useMemo(() => {
    const angle = phaseFromId(entity.id) * Math.PI * 2;
    return { dx: Math.cos(angle) * ESCORT_OFFSET_DISTANCE, dz: Math.sin(angle) * ESCORT_OFFSET_DISTANCE };
  }, [entity.id]);

  useFrame(({ clock }, delta) => {
    const t = clock.getElapsedTime() * 1.6 + phase;
    const pulse = (Math.sin(t) + 1) / 2;
    if (coreRef.current) {
      coreRef.current.scale.setScalar(0.75 + pulse * 0.35);
    }
    if (ringRef.current) {
      const ringT = (t * 0.6) % (Math.PI * 2);
      const expand = ringT / (Math.PI * 2);
      ringRef.current.scale.setScalar(0.6 + expand * 2.2);
      const mat = ringRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, 0.8 - expand);
    }

    const group = groupRef.current;
    const escortId = escortRef.current[entity.id];
    const escortObject = escortId ? robotObjectsRef.current[escortId] : undefined;
    if (group && escortObject) {
      const targetX = escortObject.position.x + escortOffset.dx;
      const targetZ = escortObject.position.z + escortOffset.dz;
      const targetY = escortObject.position.y;
      const ease = 1 - Math.exp(-delta * ESCORT_LERP_RATE);
      group.position.x += (targetX - group.position.x) * ease;
      group.position.y += (targetY - group.position.y) * ease;
      group.position.z += (targetZ - group.position.z) * ease;
    }
  });

  return (
    <group ref={groupRef} position={entity.position}>
      <mesh ref={coreRef} position={[0, 0.35, 0]} castShadow>
        <sphereGeometry args={[0.35, 16, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.6} />
      </mesh>
      <mesh position={[0, 1.6, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 3.2, 6]} />
        <meshBasicMaterial color={color} transparent opacity={0.35} />
      </mesh>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <ringGeometry args={[0.5, 0.62, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
      <pointLight color={color} intensity={2.2} distance={4} decay={2} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Fog of war - dark "unmapped sector" overlay tiles, permanently dissolving
// as rescue robots' sensor radii pass over them. Rendered as one
// InstancedMesh of thin boxes (one per fog cell, gapped slightly so the
// negative space reads as a grid, same "plain geometry, no custom GLSL"
// idiom as Terrain's vertex-colored mesh above) rather than a shader plane.
// Each tile's scale tracks `1 - explored` every frame, so clearing looks
// like a smooth shrink/dissolve rather than an instant pop, and a per-cell
// deterministic color flicker on still-hidden tiles reads as sensor static.
// ---------------------------------------------------------------------------

const FOG_TILE_FOOTPRINT_RATIO = 0.92; // leaves ~8% gaps between tiles as grid lines
const FOG_TILE_MAX_HEIGHT = 0.55;
const FOG_HEIGHT_OFFSET = 0.5; // sits just above the terrain surface
const FOG_STATIC_FLICKER = 0.55;

function FogOfWar({ map, fog }: { map: GeneratedDisasterMap; fog: FogOfWarState }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tmpColor = useMemo(() => new THREE.Color(), []);
  const baseColor = useMemo(() => new THREE.Color(PALETTE.fogOfWar), []);
  const staticColor = useMemo(() => new THREE.Color(PALETTE.fogOfWarStatic), []);
  const cellCount = fog.resolution * fog.resolution;

  // Cell centers + ground elevation are static for a given map, so they're
  // precomputed once instead of re-sampling terrain noise every frame.
  const cells = useMemo(() => {
    const centers: Array<[number, number, number]> = [];
    for (let j = 0; j < fog.resolution; j++) {
      for (let i = 0; i < fog.resolution; i++) {
        const [x, z] = fogCellCenter(i, j);
        centers.push([x, map.getElevation(x, z) + FOG_HEIGHT_OFFSET, z]);
      }
    }
    return centers;
  }, [map, fog.resolution]);

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const { explored, phases } = fog;
    const footprint = FOG_CELL_SIZE * FOG_TILE_FOOTPRINT_RATIO;
    const t = clock.getElapsedTime();

    for (let idx = 0; idx < cellCount; idx++) {
      const hidden = 1 - explored[idx];
      const [x, y, z] = cells[idx];

      dummy.position.set(x, y, z);
      dummy.scale.set(footprint * hidden, FOG_TILE_MAX_HEIGHT * hidden, footprint * hidden);
      dummy.updateMatrix();
      mesh.setMatrixAt(idx, dummy.matrix);

      const flicker = hidden > 0.02 ? Math.max(0, Math.sin(t * 4.5 + phases[idx])) * FOG_STATIC_FLICKER * hidden : 0;
      tmpColor.copy(baseColor).lerp(staticColor, flicker);
      mesh.setColorAt(idx, tmpColor);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, cellCount]}
      frustumCulled={false}
      renderOrder={5}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial
        vertexColors
        transparent
        opacity={0.92}
        depthWrite={false}
        toneMapped={false}
      />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------------------
// Rescue robots - small deterministic patrol units whose sensor radius
// permanently clears the fog-of-war grid as they roam. Path is precomputed
// once from the seed (generateRobots), then walked every frame via distance
// += delta * speed - no per-frame randomness, matching the project's "no
// Math.random in render/useFrame" convention.
// ---------------------------------------------------------------------------

const ROBOT_BOB_AMPLITUDE = 0.07;

/** Fixed-length ring buffer of recent rendered positions per robot, rendered as a dashed stale-path trail only while amber/red - see the trail Line below. */
const TRAIL_LENGTH = 40;
/** Sits just above the terrain so the dashed trail never z-fights the ground mesh. */
const TRAIL_HEIGHT_OFFSET = 0.12;
/** Exponential-ease rate for the trail's fade in/out opacity - same framerate-independent style as revealFogAround. */
const TRAIL_OPACITY_EASE_RATE = 3;
/** Exponential-ease rate for the robot body material's comms-tint blend. */
const BODY_TINT_EASE_RATE = 2.5;

function RobotUnit({
  robot,
  map,
  fog,
  showRadius,
  positionsRef,
  robotObjectsRef,
  commsStateRef,
}: {
  robot: RescueRobot;
  map: GeneratedDisasterMap;
  fog: FogOfWarState;
  showRadius: boolean;
  positionsRef: MutableRefObject<RobotPositions>;
  robotObjectsRef: MutableRefObject<RobotObjectRefs>;
  commsStateRef: MutableRefObject<RobotCommsStates>;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Mesh>(null);
  const bodyMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const trailLineRef = useRef<Line2 | null>(null);
  const distanceRef = useRef(0);
  const phase = useMemo(() => phaseFromId(robot.id) * Math.PI * 2, [robot.id]);
  const color = useMemo(() => new THREE.Color(robot.color), [robot.color]);
  const tintScratch = useMemo(() => new THREE.Color(), []);

  // Comms-drop simulation state - a smooth per-robot wobble (seeded off the
  // robot's id, not Math.random) mapped through a hysteresis tracker into a
  // discrete green/amber/red state every frame. Both live purely in refs;
  // see commsDrop.ts for the pure math this drives.
  const commsPhase = useMemo(() => commsDropPhaseForRobot(robot.id), [robot.id]);
  const commsTrackerRef = useRef(createCommsDropTracker());

  // Last rendered [x, z] - kept up to date whenever the link is NOT "red",
  // and simply left alone (never overwritten) while "red" so the robot
  // visually holds at its last-known spot instead of teleporting once the
  // link recovers. `distanceRef` above keeps accumulating regardless, so
  // resuming is a smooth continuation of the same path progress, not a jump.
  const lastKnownPosRef = useRef<[number, number]>([...robot.basePosition]);
  const trailRef = useRef<Float32Array>(new Float32Array(TRAIL_LENGTH * 3));
  const trailInitializedRef = useRef(false);

  // Initial trail geometry - a degenerate loop of TRAIL_LENGTH copies of the
  // base position, immediately overwritten frame-by-frame once mounted.
  // Only computed once per robot (pure, deterministic), matching the
  // "precompute once, mutate imperatively" pattern CommsLink already uses.
  const initialTrailPoints = useMemo<Array<[number, number, number]>>(
    () =>
      Array.from({ length: TRAIL_LENGTH }, () => [
        robot.basePosition[0],
        0,
        robot.basePosition[1],
      ]),
    [robot.basePosition]
  );

  // Publish this robot's live THREE.Group once mounted (not per-frame) so
  // CommsLinks / SurvivorMarker elsewhere in the tree can read its actual
  // rendered position every frame via a plain ref, matching the position-ref
  // pattern already used for the HUD telemetry pass below.
  useEffect(() => {
    const node = groupRef.current;
    const objects = robotObjectsRef.current;
    objects[robot.id] = node;
    return () => {
      if (objects[robot.id] === node) {
        delete objects[robot.id];
      }
    };
  }, [robot.id, robotObjectsRef]);

  useFrame(({ clock }, delta) => {
    const elapsed = clock.getElapsedTime();

    // Path progress always keeps accumulating, even while the rendered
    // position below is frozen - so recovery resumes smoothly instead of
    // skipping ahead to "catch up".
    distanceRef.current += delta * robot.speed;
    const [pathX, pathZ] = sampleRobotPosition(robot, distanceRef.current);

    const quality = commsQualityAt(elapsed, commsPhase);
    const commsState = updateCommsDropTracker(commsTrackerRef.current, quality, elapsed);
    commsStateRef.current[robot.id] = commsState;

    // Position freezes on the map while disconnected ("red") - hold at the
    // last-known spot rather than silently continuing to move.
    let x: number;
    let z: number;
    if (commsState === "red") {
      [x, z] = lastKnownPosRef.current;
    } else {
      x = pathX;
      z = pathZ;
      lastKnownPosRef.current[0] = x;
      lastKnownPosRef.current[1] = z;
    }
    const groundY = map.getElevation(x, z);

    // Keep clearing fog every frame regardless of whether the radius ring
    // is currently shown - the toggle only affects the visual, not the sim.
    // Uses the same (possibly frozen) position as everything else below,
    // so a disconnected robot's sensor feed reads as stale too.
    revealFogAround(fog, x, z, robot.radius, delta);

    // Publish the live position for the HUD telemetry pass (TelemetryTracker)
    // to read at its own throttled rate - a plain ref write, no React state.
    positionsRef.current[robot.id] = { x, z };

    if (groupRef.current) groupRef.current.position.set(x, groundY, z);
    if (bodyRef.current) {
      bodyRef.current.position.y = 0.48 + Math.sin(elapsed * 3 + phase) * ROBOT_BOB_AMPLITUDE;
    }

    // Tint the body material toward amber/red as the link degrades, on top
    // of the robot's own base color - purely a visual consistency touch.
    if (bodyMaterialRef.current) {
      const tintAmount = commsState === "green" ? 0 : commsState === "amber" ? 0.4 : 0.7;
      const tintTarget = commsState === "red" ? COMMS_TINT_RED : COMMS_TINT_AMBER;
      tintScratch.copy(color).lerp(tintTarget, tintAmount);
      const ease = 1 - Math.exp(-delta * BODY_TINT_EASE_RATE);
      bodyMaterialRef.current.color.lerp(tintScratch, ease);
      bodyMaterialRef.current.emissive.lerp(tintScratch, ease);
    }

    // Stale-path trail - a short ring buffer of recent rendered positions,
    // only actually shown (faded in) while amber/red so connected robots
    // don't clutter the view with trails.
    const trail = trailRef.current;
    if (!trailInitializedRef.current) {
      for (let i = 0; i < TRAIL_LENGTH; i++) {
        trail[i * 3] = x;
        trail[i * 3 + 1] = groundY + TRAIL_HEIGHT_OFFSET;
        trail[i * 3 + 2] = z;
      }
      trailInitializedRef.current = true;
    } else {
      trail.copyWithin(0, 3);
      trail[(TRAIL_LENGTH - 1) * 3] = x;
      trail[(TRAIL_LENGTH - 1) * 3 + 1] = groundY + TRAIL_HEIGHT_OFFSET;
      trail[(TRAIL_LENGTH - 1) * 3 + 2] = z;
    }
    const trailLine = trailLineRef.current;
    if (trailLine) {
      trailLine.geometry.setPositions(Array.from(trail));
      trailLine.computeLineDistances();
      const targetOpacity = commsState === "green" ? 0 : commsState === "amber" ? 0.4 : 0.75;
      const ease = 1 - Math.exp(-delta * TRAIL_OPACITY_EASE_RATE);
      trailLine.material.opacity += (targetOpacity - trailLine.material.opacity) * ease;
      trailLine.material.color.set(commsState === "red" ? PALETTE.commsLost : PALETTE.commsDegraded);
    }
  });

  return (
    <>
      <group ref={groupRef} userData={{ entityType: "robot", entityId: robot.id }}>
        <mesh ref={bodyRef} castShadow>
          <boxGeometry args={[0.6, 0.4, 0.85]} />
          <meshStandardMaterial
            ref={bodyMaterialRef}
            color={color}
            emissive={color}
            emissiveIntensity={0.85}
            roughness={0.35}
            metalness={0.5}
          />
        </mesh>
        <mesh position={[0, 0.82, 0]}>
          <coneGeometry args={[0.22, 0.3, 4]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.5} roughness={0.3} />
        </mesh>
        <pointLight color={robot.color} intensity={1.8} distance={6} decay={2} />

        {showRadius && (
          <group position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <mesh>
              <circleGeometry args={[robot.radius, 48]} />
              <meshBasicMaterial color={color} transparent opacity={0.06} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
            <mesh>
              <ringGeometry args={[robot.radius * 0.95, robot.radius, 64]} />
              <meshBasicMaterial color={color} transparent opacity={0.55} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
          </group>
        )}
      </group>

      {/* Stale last-known-path trail - geometry mutated imperatively every
          frame above; opacity stays ~0 (invisible) while connected. */}
      <Line
        ref={trailLineRef}
        points={initialTrailPoints}
        color={PALETTE.commsDegraded}
        lineWidth={1.3}
        dashed
        dashScale={3}
        dashSize={1.3}
        gapSize={1}
        transparent
        opacity={0}
        depthWrite={false}
      />
    </>
  );
}

function RescueRobots({
  robots,
  map,
  fog,
  showRadius,
  positionsRef,
  robotObjectsRef,
  commsStateRef,
}: {
  robots: RescueRobot[];
  map: GeneratedDisasterMap;
  fog: FogOfWarState;
  showRadius: boolean;
  positionsRef: MutableRefObject<RobotPositions>;
  robotObjectsRef: MutableRefObject<RobotObjectRefs>;
  commsStateRef: MutableRefObject<RobotCommsStates>;
}) {
  return (
    <>
      {robots.map((robot) => (
        <RobotUnit
          key={robot.id}
          robot={robot}
          map={map}
          fog={fog}
          showRadius={showRadius}
          positionsRef={positionsRef}
          robotObjectsRef={robotObjectsRef}
          commsStateRef={commsStateRef}
        />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Coordination comms links - subtle pulsing violet lines between every pair
// of rescue robots, so the fleet visually reads as "coordinating" rather
// than roaming independently. Only 3-4 robots ever exist at once, so the
// handful of O(n^2) pairs is computed once (useMemo) and each pair's line
// geometry is just updated imperatively every frame from the robots' live
// THREE.Object3D refs (see RobotUnit's registration effect above) - no
// React state, matching the project's existing frame-update conventions.
// ---------------------------------------------------------------------------

/** Distance (meters) at which a comms link reaches full strength; links stay faintly visible beyond this, never fully vanishing. */
const COMMS_COORDINATION_RANGE = 95;
/** Height (meters) the comms beam floats above each robot, clear of terrain/rubble. */
const COMMS_LINK_HEIGHT = 2.4;
/** "Marching ants" dash animation speed. */
const COMMS_DASH_SPEED = 1.1;

function CommsLink({
  a,
  b,
  robotObjectsRef,
  commsStateRef,
}: {
  a: RescueRobot;
  b: RescueRobot;
  robotObjectsRef: MutableRefObject<RobotObjectRefs>;
  commsStateRef: MutableRefObject<RobotCommsStates>;
}) {
  const lineRef = useRef<Line2 | null>(null);
  const phase = useMemo(() => phaseFromId(`${a.id}~${b.id}`) * Math.PI * 2, [a.id, b.id]);

  useFrame(({ clock }, delta) => {
    const line = lineRef.current;
    const objA = robotObjectsRef.current[a.id];
    const objB = robotObjectsRef.current[b.id];
    if (!line || !objA || !objB) return;

    line.geometry.setPositions([
      objA.position.x,
      objA.position.y + COMMS_LINK_HEIGHT,
      objA.position.z,
      objB.position.x,
      objB.position.y + COMMS_LINK_HEIGHT,
      objB.position.z,
    ]);
    line.computeLineDistances();

    // A disconnected endpoint realistically wouldn't have a working comms
    // link either - render the beam as dim/broken (dash animation stalls,
    // reading as "stuck") and tint it toward the worse of the two robots'
    // states, rather than pretending the link is still nominal.
    const stateA = commsStateRef.current[a.id] ?? "green";
    const stateB = commsStateRef.current[b.id] ?? "green";
    const worstState: CommsLinkState =
      stateA === "red" || stateB === "red" ? "red" : stateA === "amber" || stateB === "amber" ? "amber" : "green";

    if (worstState !== "red") {
      line.material.dashOffset -= delta * COMMS_DASH_SPEED;
    }

    const dist = Math.hypot(objA.position.x - objB.position.x, objA.position.z - objB.position.z);
    const proximity = THREE.MathUtils.clamp(1 - dist / COMMS_COORDINATION_RANGE, 0, 1);
    const pulse = (Math.sin(clock.getElapsedTime() * 1.8 + phase) + 1) / 2;
    // Never fully fades out (min ~0.12) so the "fleet is coordinating" read
    // stays legible even when two units are at opposite ends of the map;
    // it just gets noticeably brighter/livelier the closer they roam.
    let opacity = 0.12 + proximity * 0.5 + pulse * 0.14;
    if (worstState === "amber") opacity *= 0.65;
    if (worstState === "red") opacity *= 0.3;
    line.material.opacity = opacity;
    line.material.color.set(
      worstState === "red" ? COMMS_LINK_COLOR_RED : worstState === "amber" ? COMMS_LINK_COLOR_AMBER : PALETTE.commsLink
    );
  });

  return (
    <Line
      ref={lineRef}
      points={[
        [0, 0, 0],
        [0, 0, 0.01],
      ]}
      color={PALETTE.commsLink}
      lineWidth={1.4}
      dashed
      dashScale={2.5}
      dashSize={2}
      gapSize={1.4}
      transparent
      opacity={0.2}
      depthWrite={false}
    />
  );
}

function CommsLinks({
  robots,
  robotObjectsRef,
  commsStateRef,
}: {
  robots: RescueRobot[];
  robotObjectsRef: MutableRefObject<RobotObjectRefs>;
  commsStateRef: MutableRefObject<RobotCommsStates>;
}) {
  const pairs = useMemo(() => {
    const list: Array<{ a: RescueRobot; b: RescueRobot; key: string }> = [];
    for (let i = 0; i < robots.length; i++) {
      for (let j = i + 1; j < robots.length; j++) {
        list.push({ a: robots[i], b: robots[j], key: `${robots[i].id}~${robots[j].id}` });
      }
    }
    return list;
  }, [robots]);

  return (
    <>
      {pairs.map(({ a, b, key }) => (
        <CommsLink key={key} a={a} b={b} robotObjectsRef={robotObjectsRef} commsStateRef={commsStateRef} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Sun - a simple glowing sphere "just for show", plus the light it casts
// ---------------------------------------------------------------------------

function Sun() {
  return (
    <group position={SUN_MESH_POSITION}>
      {/* Bright core disc. toneMapped=false keeps it looking blown-out/hot,
          fog=false stops the distant scene fog from dimming it out. */}
      <mesh>
        <sphereGeometry args={[SUN_RADIUS, 24, 24]} />
        <meshBasicMaterial color={PALETTE.sun} toneMapped={false} fog={false} />
      </mesh>
      {/* Soft halo layers for a cheap glow, no post-processing needed */}
      <mesh scale={1.7}>
        <sphereGeometry args={[SUN_RADIUS, 16, 16]} />
        <meshBasicMaterial
          color={PALETTE.sunHalo}
          transparent
          opacity={0.32}
          depthWrite={false}
          toneMapped={false}
          fog={false}
        />
      </mesh>
      <mesh scale={2.6}>
        <sphereGeometry args={[SUN_RADIUS, 16, 16]} />
        <meshBasicMaterial
          color={PALETTE.sunHalo}
          transparent
          opacity={0.16}
          depthWrite={false}
          toneMapped={false}
          fog={false}
        />
      </mesh>
      <mesh scale={4}>
        <sphereGeometry args={[SUN_RADIUS, 16, 16]} />
        <meshBasicMaterial
          color={PALETTE.sunHalo}
          transparent
          opacity={0.07}
          depthWrite={false}
          toneMapped={false}
          fog={false}
        />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Orbit controls: top-down isometric, smooth damping, clamped pan + zoom
// ---------------------------------------------------------------------------

function TacticalOrbitControls() {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const PAN_LIMIT = MAP_HALF + 20;

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.target.x = THREE.MathUtils.clamp(controls.target.x, -PAN_LIMIT, PAN_LIMIT);
    controls.target.z = THREE.MathUtils.clamp(controls.target.z, -PAN_LIMIT, PAN_LIMIT);
    controls.target.y = 0;
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={35}
      maxDistance={230}
      minPolarAngle={0.35}
      maxPolarAngle={Math.PI / 2.7}
      panSpeed={0.6}
      zoomSpeed={0.75}
      rotateSpeed={0.5}
      screenSpacePanning={false}
    />
  );
}

// ---------------------------------------------------------------------------
// Scene contents
// ---------------------------------------------------------------------------

function Scene({
  map,
  robots,
  fog,
  showExplorationRadius,
  showHazards,
  showRoutes,
  showBlockedPaths,
  onEntityClick,
  positionsRef,
  robotObjectsRef,
  commsStateRef,
  escortRef,
  cellEntities,
  sessionStartRef,
  onTelemetryUpdate,
}: {
  map: GeneratedDisasterMap;
  robots: RescueRobot[];
  fog: FogOfWarState;
  showExplorationRadius: boolean;
  showHazards: boolean;
  showRoutes: boolean;
  showBlockedPaths: boolean;
  onEntityClick?: (entity: MapEntity) => void;
  positionsRef: MutableRefObject<RobotPositions>;
  robotObjectsRef: MutableRefObject<RobotObjectRefs>;
  commsStateRef: MutableRefObject<RobotCommsStates>;
  escortRef: MutableRefObject<SurvivorEscortMap>;
  cellEntities: Map<number, MapEntity[]>;
  sessionStartRef: MutableRefObject<number>;
  onTelemetryUpdate?: (snapshot: TelemetrySnapshot) => void;
}) {
  const handleClick = (entity: MapEntity) => (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onEntityClick?.(entity);
  };

  return (
    <>
      <color attach="background" args={[PALETTE.fog]} />
      <fog attach="fog" args={[PALETTE.fog, 130, 360]} />

      {/* Bright, warm sunlight - the key light that actually lights the scene */}
      <hemisphereLight color="#dce8b8" groundColor="#4a4230" intensity={1.15} />
      <ambientLight color="#5a5240" intensity={0.7} />
      <directionalLight
        color={PALETTE.sun}
        intensity={2.8}
        position={SUN_LIGHT_POSITION}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={420}
        shadow-camera-left={-150}
        shadow-camera-right={150}
        shadow-camera-top={150}
        shadow-camera-bottom={-150}
      />
      {/* Cool fill light from the opposite side, keeps shadows from going pure black */}
      <directionalLight color="#7ea8ff" intensity={0.45} position={[-90, 70, -60]} />

      <Sun />

      <gridHelper args={[MAP_SIZE, 40, "#2c3a4a", "#1a2230"]} position={[0, 0.02, 0]} />

      <Terrain map={map} />
      {showRoutes && <RouteLines map={map} />}

      {map.rubble.map((r) => (
        <group key={r.id} onClick={handleClick(r)}>
          <RubblePile entity={r} map={map} />
        </group>
      ))}
      {showBlockedPaths &&
        map.blockedPaths.map((r) => (
          <group key={r.id} onClick={handleClick(r)}>
            <RubblePile entity={r} map={map} blocked />
          </group>
        ))}
      {showHazards &&
        map.hazards.map((h) => (
          <group key={h.id} onClick={handleClick(h)}>
            <HazardMarker entity={h} />
          </group>
        ))}
      {map.survivors.map((s) => (
        <group key={s.id} onClick={handleClick(s)}>
          <SurvivorMarker entity={s} escortRef={escortRef} robotObjectsRef={robotObjectsRef} />
        </group>
      ))}

      <RescueRobots
        robots={robots}
        map={map}
        fog={fog}
        showRadius={showExplorationRadius}
        positionsRef={positionsRef}
        robotObjectsRef={robotObjectsRef}
        commsStateRef={commsStateRef}
      />
      <CommsLinks robots={robots} robotObjectsRef={robotObjectsRef} commsStateRef={commsStateRef} />
      <FogOfWar map={map} fog={fog} />
      <TelemetryTracker
        map={map}
        robots={robots}
        fog={fog}
        positionsRef={positionsRef}
        commsStateRef={commsStateRef}
        cellEntities={cellEntities}
        sessionStartRef={sessionStartRef}
        escortRef={escortRef}
        onTelemetryUpdate={onTelemetryUpdate}
      />

      <TacticalOrbitControls />
    </>
  );
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export interface DisasterMap3DProps {
  /** Integer-hashed seed string driving terrain + city generation. */
  seed?: string;
  /** Fired once per generation with the full deterministic map payload. */
  onGenerated?: (map: GeneratedDisasterMap) => void;
  /** Fired when a rubble/hazard/survivor entity mesh is clicked. */
  onEntityClick?: (entity: MapEntity) => void;
  /**
   * Show/hide the translucent sensor-radius ring under each rescue robot.
   * Purely visual - the robots keep patrolling and clearing fog-of-war
   * either way, this only toggles whether the ring itself is drawn.
   */
  showExplorationRadius?: boolean;
  /** Fired once per generation with the deterministic rescue-robot roster (positions/paths/radius all derive from the same seed). */
  onRobotsGenerated?: (robots: RescueRobot[]) => void;
  /** Show/hide the structural hazard markers (ember/wireframe warnings). Defaults to true. */
  showHazards?: boolean;
  /** Show/hide the glowing clear-corridor route lines. Defaults to true. */
  showRoutes?: boolean;
  /** Show/hide the deliberately-dumped rubble piles blocking corridors. Defaults to true. */
  showBlockedPaths?: boolean;
  /**
   * Fired at a throttled ~4Hz with the latest mission telemetry (survivor
   * found/pending count, per-robot battery/signal/task, and any newly
   * detected hazard/survivor feed entries) - see TelemetryTracker.tsx.
   */
  onTelemetryUpdate?: (snapshot: TelemetrySnapshot) => void;
  className?: string;
}

export default function DisasterMap3D({
  seed = DEFAULT_SEED,
  onGenerated,
  onEntityClick,
  showExplorationRadius = false,
  onRobotsGenerated,
  showHazards = true,
  showRoutes = true,
  showBlockedPaths = true,
  onTelemetryUpdate,
  className,
}: DisasterMap3DProps) {
  const map = useMemo(() => generateDisasterMap(seed), [seed]);
  const robots = useMemo(() => generateRobots(seed, map), [seed, map]);
  // Robots' home base(s) seed the initial ~20%-explored cluster, so the fog
  // pattern and robot roster always agree and both stay fully deterministic
  // per-seed.
  const fog = useMemo(
    () => createFogOfWar(seed, robots.map((r) => r.basePosition)),
    [seed, robots]
  );

  // One-time reverse lookup (per map) from fog-cell index -> the
  // hazard/blocked-path/survivor entities sitting in it, so
  // TelemetryTracker's reveal-event scan is O(revealed cells) instead of
  // O(cells * entities) every frame. Deliberately excludes plain rubble -
  // logging every rubble block would spam the feed, per the HUD spec.
  const cellEntities = useMemo(() => {
    const lookup = new Map<number, MapEntity[]>();
    for (const entity of [...map.hazards, ...map.blockedPaths, ...map.survivors]) {
      const idx = cellIndexForPosition(entity.position[0], entity.position[2]);
      const bucket = lookup.get(idx);
      if (bucket) bucket.push(entity);
      else lookup.set(idx, [entity]);
    }
    return lookup;
  }, [map]);

  // Live per-robot [x, z], written every frame by RobotUnit and read
  // (throttled) by TelemetryTracker - a plain ref, never React state, so
  // 60fps position updates never trigger a re-render on their own.
  const positionsRef = useRef<RobotPositions>({});
  // Live per-robot THREE.Object3D, registered once per robot (RobotUnit's
  // mount effect) and read every frame by CommsLinks/SurvivorMarker for
  // their own imperative position updates - see RobotObjectRefs above.
  const robotObjectsRef = useRef<RobotObjectRefs>({});
  // Live per-robot comms-link health (green/amber/red), written every frame
  // by RobotUnit's comms-drop simulation and read by CommsLinks (to render
  // broken/dashed links) and TelemetryTracker (to report it up to the HUD
  // at the usual throttled cadence) - see commsDrop.ts.
  const commsStateRef = useRef<RobotCommsStates>({});
  // Which robot is escorting each found survivor, written once by
  // TelemetryTracker the moment a survivor is revealed - see
  // SurvivorEscortMap's doc comment in telemetry.ts.
  const escortRef = useRef<SurvivorEscortMap>({});
  // Wall-clock session start for this seed, driving battery drain / feed
  // timestamps - resets whenever the seed (and therefore the whole map)
  // changes, matching the HUD's mission clock reset behavior. `Date.now()`
  // is deliberately called inside the effect below (never directly during
  // render) so it stays a pure render pass.
  const sessionStartRef = useRef<number>(0);

  useEffect(() => {
    onGenerated?.(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  useEffect(() => {
    onRobotsGenerated?.(robots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [robots]);

  useEffect(() => {
    sessionStartRef.current = Date.now();
    positionsRef.current = {};
    commsStateRef.current = {};
  }, [seed]);

  return (
    <div className={className} style={{ width: "100%", height: "100%" }}>
      <Canvas
        shadows
        dpr={[1, 1.75]}
        camera={{ position: [70, 95, 70], fov: 42, near: 0.1, far: 800 }}
        gl={{ antialias: true }}
      >
        <Scene
          map={map}
          robots={robots}
          fog={fog}
          showExplorationRadius={showExplorationRadius}
          showHazards={showHazards}
          showRoutes={showRoutes}
          showBlockedPaths={showBlockedPaths}
          onEntityClick={onEntityClick}
          positionsRef={positionsRef}
          robotObjectsRef={robotObjectsRef}
          commsStateRef={commsStateRef}
          escortRef={escortRef}
          cellEntities={cellEntities}
          sessionStartRef={sessionStartRef}
          onTelemetryUpdate={onTelemetryUpdate}
        />
      </Canvas>
    </div>
  );
}
