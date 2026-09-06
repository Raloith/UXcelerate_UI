"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Activity,
  AlertTriangle,
  Blocks,
  Bot,
  HeartPulse,
  Leaf,
  Radar,
  Route as RouteIcon,
  SlidersHorizontal,
} from "lucide-react";

import type {
  FeedEntry,
  GeneratedDisasterMap,
  MapEntity,
  QueuedCommand,
  QueuedCommandKind,
  RescueRobot,
  RobotTelemetry,
  TelemetrySnapshot,
} from "@/components/disaster-map/DisasterMap3D";
import { CANNED_COMMANDS, makeCommandExecutedFeedEntry } from "@/components/disaster-map/DisasterMap3D";
import SeedControlPanel from "@/components/disaster-map/SeedControlPanel";
import TopHudBar from "@/components/hud/TopHudBar";
import RobotFleetDrawer from "@/components/hud/RobotFleetDrawer";
import HazardFeedDrawer from "@/components/hud/HazardFeedDrawer";
import FilterTogglesBar from "@/components/hud/FilterTogglesBar";
import CommandToasts, { type CommandToast } from "@/components/hud/CommandToasts";
import { useCommsStability } from "@/components/hud/useCommsStability";

const DisasterMap3D = dynamic(
  () => import("@/components/disaster-map/DisasterMap3D"),
  { ssr: false }
);

const DEFAULT_SEED = "QUAKE-7821";
/** Keep the live feed readable - cap at the last ~50 entries, newest on top. */
const FEED_LOG_CAP = 50;

interface TelemetryState {
  survivorsFound: number;
  survivorsTotal: number;
  robots: RobotTelemetry[];
  elapsedSeconds: number;
}

const EMPTY_TELEMETRY: TelemetryState = {
  survivorsFound: 0,
  survivorsTotal: 0,
  robots: [],
  elapsedSeconds: 0,
};

/** Pending Emergency Beacon command per robot, keyed by robot id. */
type QueuedCommandsState = Record<string, QueuedCommand | undefined>;

export default function Home() {
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [map, setMap] = useState<GeneratedDisasterMap | null>(null);
  const [robots, setRobots] = useState<RescueRobot[] | null>(null);
  const [selected, setSelected] = useState<MapEntity | null>(null);
  const [showRobotRadius, setShowRobotRadius] = useState(false);

  // Bottom quick-filters: hide/show entity groups in the 3D scene.
  const [showHazards, setShowHazards] = useState(true);
  const [showRoutes, setShowRoutes] = useState(true);
  const [showBlockedPaths, setShowBlockedPaths] = useState(true);
  const [showGrid, setShowGrid] = useState(true);

  // Left/right HUD drawers.
  const [fleetOpen, setFleetOpen] = useState(false);
  const [feedOpen, setFeedOpen] = useState(false);
  // Top-left seed control panel - a third floating panel following the same
  // open/closed convention as the two drawers above (default closed, an
  // external affordance reopens it) so it stops permanently blocking the view.
  const [seedPanelOpen, setSeedPanelOpen] = useState(false);

  // Live mission telemetry, pushed up (throttled to ~4Hz) from DisasterMap3D.
  const [telemetry, setTelemetry] = useState<TelemetryState>(EMPTY_TELEMETRY);
  const [feedLog, setFeedLog] = useState<FeedEntry[]>([]);

  // Emergency Beacon: operator-queued commands per robot, and their
  // toast confirmations. Session/operator state, not part of the 3D
  // telemetry pipeline - lives here rather than in DisasterMap3D.
  const [queuedCommands, setQueuedCommands] = useState<QueuedCommandsState>({});
  const [toasts, setToasts] = useState<CommandToast[]>([]);
  // Mirrors `queuedCommands` for the throttled telemetry callback below to
  // read without needing to be re-created every time the state changes.
  const queuedCommandsRef = useRef<QueuedCommandsState>({});
  const toastSeqRef = useRef(0);
  const commandFeedSeqRef = useRef(0);

  useEffect(() => {
    queuedCommandsRef.current = queuedCommands;
  }, [queuedCommands]);

  const comms = useCommsStability(seed);

  const pushToast = useCallback((message: string) => {
    const id = `toast-${toastSeqRef.current++}`;
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3600);
  }, []);

  const handleGenerated = useCallback((generated: GeneratedDisasterMap) => {
    setMap(generated);
  }, []);

  const handleRobotsGenerated = useCallback((generated: RescueRobot[]) => {
    setRobots(generated);
  }, []);

  const handleEntityClick = useCallback((entity: MapEntity) => {
    setSelected(entity);
  }, []);

  const handleTelemetryUpdate = useCallback((snapshot: TelemetrySnapshot) => {
    setTelemetry({
      survivorsFound: snapshot.survivorsFound,
      survivorsTotal: snapshot.survivorsTotal,
      robots: snapshot.robots,
      elapsedSeconds: snapshot.elapsedSeconds,
    });
    if (snapshot.newFeedEntries.length > 0) {
      setFeedLog((prev) =>
        [...snapshot.newFeedEntries].reverse().concat(prev).slice(0, FEED_LOG_CAP)
      );
    }

    // Resolve any queued Emergency Beacon commands whose target robot's
    // link just came back up (green) - "execute" = log a feed entry and
    // clear the pending command, per the queued-command lifecycle spec.
    const queued = queuedCommandsRef.current;
    const executedRobotIds: string[] = [];
    const executedEntries: FeedEntry[] = [];
    for (const robotTelemetry of snapshot.robots) {
      const command = queued[robotTelemetry.id];
      if (command && robotTelemetry.commsState === "green") {
        executedEntries.push(
          makeCommandExecutedFeedEntry(
            robotTelemetry,
            command,
            snapshot.elapsedSeconds,
            commandFeedSeqRef.current++
          )
        );
        executedRobotIds.push(robotTelemetry.id);
      }
    }
    if (executedEntries.length > 0) {
      setFeedLog((prev) => [...executedEntries].reverse().concat(prev).slice(0, FEED_LOG_CAP));
      setQueuedCommands((prev) => {
        const next = { ...prev };
        for (const id of executedRobotIds) delete next[id];
        return next;
      });
    }
  }, []);

  const handleApplySeed = useCallback((nextSeed: string) => {
    setSelected(null);
    setSeed(nextSeed);
    // Live telemetry is runtime state, not part of the deterministic seed
    // payload - reset it explicitly so the new session starts clean instead
    // of showing the previous seed's stale found-count/feed log.
    setTelemetry(EMPTY_TELEMETRY);
    setFeedLog([]);
    setQueuedCommands({});
    setToasts([]);
  }, []);

  const handleDispatchCommand = useCallback(
    (robotId: string, kind: QueuedCommandKind) => {
      const robot = telemetry.robots.find((r) => r.id === robotId);
      const label = CANNED_COMMANDS.find((c) => c.kind === kind)?.label ?? kind;
      const robotLabel = robot?.label ?? robotId;
      setQueuedCommands((prev) => ({
        ...prev,
        [robotId]: { robotId, kind, label, queuedAtSeconds: telemetry.elapsedSeconds },
      }));
      pushToast(`Command queued for ${robotLabel} — will execute on reconnect: ${label.toUpperCase()}.`);
    },
    [telemetry.robots, telemetry.elapsedSeconds, pushToast]
  );

  const handleBroadcastCommand = useCallback(
    (kind: QueuedCommandKind) => {
      const label = CANNED_COMMANDS.find((c) => c.kind === kind)?.label ?? kind;
      const targets = telemetry.robots.filter(
        (r) => r.commsState !== "green" && !queuedCommandsRef.current[r.id]
      );
      if (targets.length === 0) {
        pushToast("All units already nominal or have a command pending — nothing to broadcast.");
        return;
      }
      setQueuedCommands((prev) => {
        const next = { ...prev };
        for (const r of targets) {
          next[r.id] = { robotId: r.id, kind, label, queuedAtSeconds: telemetry.elapsedSeconds };
        }
        return next;
      });
      pushToast(
        `Broadcast queued for ${targets.length} unit${targets.length === 1 ? "" : "s"} — will execute on reconnect: ${label.toUpperCase()}.`
      );
    },
    [telemetry.robots, telemetry.elapsedSeconds, pushToast]
  );

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
        showHazards={showHazards}
        showRoutes={showRoutes}
        showBlockedPaths={showBlockedPaths}
        showGrid={showGrid}
        onTelemetryUpdate={handleTelemetryUpdate}
        className="absolute inset-0"
      />

      {/* Top bar: seed identity + mission clock + survivor found/pending + comms + drawer toggles.
          Keyed by seed so its internal mission clock remounts (resets to T+00:00:00)
          whenever a new map is generated - see useMissionClock's doc comment. */}
      <TopHudBar
        key={seed}
        seedLabel={map?.seed ?? seed}
        survivorsFound={telemetry.survivorsFound}
        survivorsTotal={telemetry.survivorsTotal || map?.survivors.length || 0}
        comms={comms}
        fleetOpen={fleetOpen}
        onToggleFleet={() => setFleetOpen((prev) => !prev)}
        feedOpen={feedOpen}
        onToggleFeed={() => setFeedOpen((prev) => !prev)}
      />

      {/* Seed controls: regenerate randomly or type your own. Collapsible so
          it never permanently blocks the view - closed by default, matching
          the two HUD drawers' open/closed convention, with a small floating
          tab left behind to reopen it. */}
      <div className="absolute left-4 top-24 z-20 sm:left-6 sm:top-28">
        <AnimatePresence mode="wait" initial={false}>
          {seedPanelOpen ? (
            <motion.div
              key="seed-panel"
              initial={{ opacity: 0, x: -24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ type: "spring", stiffness: 260, damping: 28 }}
            >
              <SeedControlPanel
                currentSeed={map?.seed ?? seed}
                onApplySeed={handleApplySeed}
                onClose={() => setSeedPanelOpen(false)}
              />
            </motion.div>
          ) : (
            <motion.button
              key="seed-tab"
              type="button"
              onClick={() => setSeedPanelOpen(true)}
              initial={{ opacity: 0, x: -24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ type: "spring", stiffness: 260, damping: 28 }}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              aria-expanded={false}
              aria-label="Show seed control panel"
              className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/10 bg-black/75 px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-cyan-200 shadow-lg shadow-black/40 backdrop-blur-md transition-colors hover:border-cyan-400/40 hover:bg-black/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              Seed Control
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Left drawer: Robot Fleet Status */}
      <RobotFleetDrawer
        open={fleetOpen}
        onClose={() => setFleetOpen(false)}
        robots={telemetry.robots}
        queuedCommands={queuedCommands}
        onDispatchCommand={handleDispatchCommand}
        onBroadcastCommand={handleBroadcastCommand}
      />

      {/* Right drawer: Live Hazard & Survivor Feed */}
      <HazardFeedDrawer open={feedOpen} onClose={() => setFeedOpen(false)} entries={feedLog} />

      {/* Emergency Beacon dispatch/broadcast confirmations */}
      <CommandToasts toasts={toasts} />

      {/* Bottom chrome: quick filters + stats HUD */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1, ease: "easeOut" }}
        className="pointer-events-none absolute bottom-0 left-0 flex w-full flex-col gap-2.5 p-4 sm:p-6"
      >
        <FilterTogglesBar
          showHazards={showHazards}
          onToggleHazards={() => setShowHazards((prev) => !prev)}
          showRoutes={showRoutes}
          onToggleRoutes={() => setShowRoutes((prev) => !prev)}
          showBlockedPaths={showBlockedPaths}
          onToggleBlockedPaths={() => setShowBlockedPaths((prev) => !prev)}
          showGrid={showGrid}
          onToggleGrid={() => setShowGrid((prev) => !prev)}
        />

        <div className="flex flex-wrap gap-3">
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
        </div>
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
