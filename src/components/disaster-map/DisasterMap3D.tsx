"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

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

/** Deterministic 0..1 float derived from a string id (no Math.random). */
function phaseFromId(id: string): number {
  return (hashStringToSeed(id) % 1000) / 1000;
}

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

// ---------------------------------------------------------------------------
// Palette - colorful biomes, still dark & technical at the edges/hazards
// ---------------------------------------------------------------------------

const PALETTE = {
  rubbleA: "#6b6154",
  rubbleB: "#847a64",
  rubbleBlocked: "#8a6146",
  route: "#38f2ff",
  survivor: "#3dffb0",
  survivorCritical: "#ff5a4d",
  hazardEmber: "#ff7a1a",
  hazardWire: "#ffcf3f",
  fog: "#241f16",
  sun: "#fff2c9",
  sunHalo: "#ffcf6b",
} as const;

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
// Survivors - pulsing beacon markers pinned at ground level
// ---------------------------------------------------------------------------

function SurvivorMarker({ entity }: { entity: MapEntity }) {
  const ringRef = useRef<THREE.Mesh>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const phase = entity.metadata.phase as number;
  const critical = entity.metadata.status === "critical";
  const color = critical ? PALETTE.survivorCritical : PALETTE.survivor;

  useFrame(({ clock }) => {
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
  });

  return (
    <group position={entity.position}>
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
  onEntityClick,
}: {
  map: GeneratedDisasterMap;
  onEntityClick?: (entity: MapEntity) => void;
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
      <RouteLines map={map} />

      {map.rubble.map((r) => (
        <group key={r.id} onClick={handleClick(r)}>
          <RubblePile entity={r} map={map} />
        </group>
      ))}
      {map.blockedPaths.map((r) => (
        <group key={r.id} onClick={handleClick(r)}>
          <RubblePile entity={r} map={map} blocked />
        </group>
      ))}
      {map.hazards.map((h) => (
        <group key={h.id} onClick={handleClick(h)}>
          <HazardMarker entity={h} />
        </group>
      ))}
      {map.survivors.map((s) => (
        <group key={s.id} onClick={handleClick(s)}>
          <SurvivorMarker entity={s} />
        </group>
      ))}

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
  className?: string;
}

export default function DisasterMap3D({
  seed = DEFAULT_SEED,
  onGenerated,
  onEntityClick,
  className,
}: DisasterMap3DProps) {
  const map = useMemo(() => generateDisasterMap(seed), [seed]);

  useEffect(() => {
    onGenerated?.(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  return (
    <div className={className} style={{ width: "100%", height: "100%" }}>
      <Canvas
        shadows
        dpr={[1, 1.75]}
        camera={{ position: [70, 95, 70], fov: 42, near: 0.1, far: 800 }}
        gl={{ antialias: true }}
      >
        <Scene map={map} onEntityClick={onEntityClick} />
      </Canvas>
    </div>
  );
}
