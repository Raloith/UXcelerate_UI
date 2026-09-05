"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Activity,
  AlertTriangle,
  Blocks,
  Bot,
  HeartPulse,
  Leaf,
  Radar,
  Radio,
  Route as RouteIcon,
} from "lucide-react";

import type {
  GeneratedDisasterMap,
  MapEntity,
  RescueRobot,
} from "@/components/disaster-map/DisasterMap3D";
import SeedControlPanel from "@/components/disaster-map/SeedControlPanel";

const DisasterMap3D = dynamic(
  () => import("@/components/disaster-map/DisasterMap3D"),
  { ssr: false }
);

const DEFAULT_SEED = "QUAKE-7821";

export default function Home() {
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [map, setMap] = useState<GeneratedDisasterMap | null>(null);
  const [robots, setRobots] = useState<RescueRobot[] | null>(null);
  const [selected, setSelected] = useState<MapEntity | null>(null);
  const [showRobotRadius, setShowRobotRadius] = useState(false);

  const handleGenerated = useCallback((generated: GeneratedDisasterMap) => {
    setMap(generated);
  }, []);

  const handleRobotsGenerated = useCallback((generated: RescueRobot[]) => {
    setRobots(generated);
  }, []);

  const handleEntityClick = useCallback((entity: MapEntity) => {
    setSelected(entity);
  }, []);

  const handleApplySeed = useCallback((nextSeed: string) => {
    setSelected(null);
    setSeed(nextSeed);
  }, []);

  const handleToggleRobotRadius = useCallback(() => {
    setShowRobotRadius((prev) => !prev);
  }, []);

  return (
    <div className="relative h-screen w-full overflow-hidden bg-black text-zinc-100">
      <DisasterMap3D
        seed={seed}
        onGenerated={handleGenerated}
        onRobotsGenerated={handleRobotsGenerated}
        onEntityClick={handleEntityClick}
        showExplorationRadius={showRobotRadius}
        className="absolute inset-0"
      />

      {/* Top bar */}
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-4 border-b border-white/10 bg-gradient-to-b from-black/80 to-transparent p-4 sm:p-6"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md border border-cyan-400/40 bg-cyan-400/10">
            <Radio className="h-4 w-4 text-cyan-300" />
          </div>
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-cyan-300/80">
              Rescue Ops &middot; Live Site Map
            </p>
            <h1 className="font-mono text-sm font-semibold tracking-wide text-zinc-50 sm:text-base">
              SEED {map?.seed ?? seed} &nbsp;/&nbsp; SECTOR-04
            </h1>
          </div>
        </div>

        <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 font-mono text-xs text-emerald-300 sm:flex">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          LIVE FEED
        </div>
      </motion.div>

      {/* Seed controls: regenerate randomly or type your own */}
      <div className="absolute left-4 top-24 sm:left-6 sm:top-28">
        <SeedControlPanel currentSeed={map?.seed ?? seed} onApplySeed={handleApplySeed} />
      </div>

      {/* Stats HUD */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1, ease: "easeOut" }}
        className="pointer-events-none absolute bottom-0 left-0 flex flex-wrap gap-3 p-4 sm:p-6"
      >
        <HudStat
          icon={<HeartPulse className="h-4 w-4" />}
          label="Survivors"
          value={map?.survivors.length ?? "-"}
          tone="emerald"
        />
        <HudStat
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Hazards"
          value={map?.hazards.length ?? "-"}
          tone="amber"
        />
        <HudStat
          icon={<Blocks className="h-4 w-4" />}
          label="Blocked Paths"
          value={map?.blockedPaths.length ?? "-"}
          tone="rose"
        />
        <HudStat
          icon={<RouteIcon className="h-4 w-4" />}
          label="Clear Corridors"
          value={map?.corridors.length ?? "-"}
          tone="cyan"
        />
        <HudStat
          icon={<Activity className="h-4 w-4" />}
          label="Rubble Blocks"
          value={map?.rubble.length ?? "-"}
          tone="zinc"
        />
        <HudStat
          icon={<Leaf className="h-4 w-4" />}
          label="Terrain"
          value={map ? capitalize(map.biomes.dominant) : "-"}
          tone="emerald"
        />
        <HudStat
          icon={<Bot className="h-4 w-4" />}
          label="Rescue Robots"
          value={robots?.length ?? "-"}
          tone="sky"
        />
        <RobotRadiusToggle active={showRobotRadius} onToggle={handleToggleRobotRadius} />
      </motion.div>

      {/* Selected entity inspector */}
      <AnimatePresence>
        {selected && (
          <motion.div
            key={selected.id}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="absolute right-4 top-24 w-64 rounded-lg border border-white/10 bg-black/70 p-4 font-mono text-xs backdrop-blur sm:right-6"
          >
            <button
              onClick={() => setSelected(null)}
              className="absolute right-2 top-2 text-zinc-500 hover:text-zinc-200"
              aria-label="Close"
            >
              ×
            </button>
            <p className="mb-1 uppercase tracking-widest text-cyan-300/80">
              {selected.type}
            </p>
            <p className="mb-3 break-all text-zinc-200">{selected.id}</p>
            <div className="space-y-1 text-zinc-400">
              <p>
                x: {selected.position[0].toFixed(1)} &nbsp; y:{" "}
                {selected.position[1].toFixed(2)} &nbsp; z:{" "}
                {selected.position[2].toFixed(1)}
              </p>
              {Object.entries(selected.metadata)
                .filter(([k]) => k !== "boxes")
                .map(([k, v]) => (
                  <p key={k} className="truncate">
                    {k}: {String(v)}
                  </p>
                ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function HudStat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tone: "emerald" | "amber" | "rose" | "cyan" | "zinc" | "sky";
}) {
  const toneClasses: Record<typeof tone, string> = {
    emerald: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10",
    amber: "text-amber-300 border-amber-400/30 bg-amber-400/10",
    rose: "text-rose-300 border-rose-400/30 bg-rose-400/10",
    cyan: "text-cyan-300 border-cyan-400/30 bg-cyan-400/10",
    zinc: "text-zinc-300 border-zinc-400/30 bg-zinc-400/10",
    sky: "text-sky-300 border-sky-400/30 bg-sky-400/10",
  };

  return (
    <div
      className={`flex items-center gap-2 rounded-md border px-3 py-2 backdrop-blur ${toneClasses[tone]}`}
    >
      {icon}
      <div className="leading-tight">
        <p className="font-mono text-[10px] uppercase tracking-widest opacity-70">
          {label}
        </p>
        <p className="font-mono text-sm font-semibold">{value}</p>
      </div>
    </div>
  );
}

/**
 * Accessible toggle for the robots' live sensor-radius rings. Purely
 * cosmetic - hiding the ring never pauses fog-of-war clearing, it just
 * stops drawing the glowing circle under each robot. Uses `aria-pressed`
 * (not just visual color) so the on/off state is announced to screen
 * readers, matching the accessibility conventions in SeedControlPanel.
 */
function RobotRadiusToggle({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      aria-label={
        active
          ? "Hide robot exploration radius rings"
          : "Show robot exploration radius rings"
      }
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      className={`pointer-events-auto flex items-center gap-2 rounded-md border px-3 py-2 font-mono backdrop-blur transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 ${
        active
          ? "border-cyan-400/50 bg-cyan-400/15 text-cyan-200"
          : "border-white/10 bg-black/30 text-zinc-400 hover:border-white/20 hover:text-zinc-200"
      }`}
    >
      <Radar className="h-4 w-4" aria-hidden="true" />
      <div className="text-left leading-tight">
        <p className="text-[10px] uppercase tracking-widest opacity-70">
          Sensor Radius
        </p>
        <p className="text-sm font-semibold">{active ? "Visible" : "Hidden"}</p>
      </div>
    </motion.button>
  );
}
