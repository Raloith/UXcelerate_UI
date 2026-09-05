"use client";

/**
 * Top HUD bar: mission identity (seed) + real-time telemetry (mission
 * clock, survivor found/pending, comms stability) + the two drawer
 * toggles. Frosted-glass chrome matching SeedControlPanel's language, but
 * the interactive bits opt back into `pointer-events-auto` individually
 * (same pattern as page.tsx's existing "Sensor Radius" toggle) so the
 * mostly-decorative bar never blocks orbit-drag on the canvas underneath.
 */

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { Bot, Radio, Rss, SignalHigh, SignalLow, SignalMedium } from "lucide-react";
import type { CommsStability, CommsTone } from "./useCommsStability";
import { useMissionClock } from "./useMissionClock";

export interface TopHudBarProps {
  seedLabel: string;
  survivorsFound: number;
  survivorsTotal: number;
  comms: CommsStability;
  fleetOpen: boolean;
  onToggleFleet: () => void;
  feedOpen: boolean;
  onToggleFeed: () => void;
}

const COMMS_TONE_STYLES: Record<CommsTone, string> = {
  nominal: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10",
  degraded: "text-amber-300 border-amber-400/30 bg-amber-400/10",
  critical: "text-rose-300 border-rose-400/30 bg-rose-400/10",
};

const COMMS_TONE_LABEL: Record<CommsTone, string> = {
  nominal: "NOMINAL",
  degraded: "DEGRADED",
  critical: "CRITICAL",
};

function CommsIcon({ tone }: { tone: CommsTone }) {
  if (tone === "nominal") return <SignalHigh className="h-4 w-4" aria-hidden="true" />;
  if (tone === "degraded") return <SignalMedium className="h-4 w-4" aria-hidden="true" />;
  return <SignalLow className="h-4 w-4" aria-hidden="true" />;
}

export default function TopHudBar({
  seedLabel,
  survivorsFound,
  survivorsTotal,
  comms,
  fleetOpen,
  onToggleFleet,
  feedOpen,
  onToggleFeed,
}: TopHudBarProps) {
  // Owned here (not passed as a prop) so that resetting the clock on a new
  // seed is just "the parent renders this component with a fresh `key`" -
  // see useMissionClock's own doc comment for why.
  const missionClock = useMissionClock();

  return (
    <motion.div
      initial={{ opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-gradient-to-b from-black/80 to-transparent p-4 sm:p-6"
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
            SEED {seedLabel} &nbsp;/&nbsp; SECTOR-04
          </h1>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <HudChip label="Mission Clock" value={missionClock.label} tone="cyan" />
        <HudChip
          label="Survivors"
          value={`${survivorsFound} / ${survivorsTotal} RECOVERED`}
          tone="emerald"
        />
        <div
          className={`flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-xs backdrop-blur ${COMMS_TONE_STYLES[comms.tone]}`}
          title={`Comms stability: ${comms.percent}% (${COMMS_TONE_LABEL[comms.tone]})`}
        >
          <CommsIcon tone={comms.tone} />
          <span className="font-semibold">{comms.percent}%</span>
          <span className="hidden text-[10px] uppercase tracking-widest opacity-70 sm:inline">
            {COMMS_TONE_LABEL[comms.tone]}
          </span>
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          <ToggleIconButton
            active={fleetOpen}
            onClick={onToggleFleet}
            icon={<Bot className="h-4 w-4" aria-hidden="true" />}
            visibleLabel="Fleet"
            ariaLabel={
              fleetOpen ? "Hide robot fleet status drawer" : "Show robot fleet status drawer"
            }
          />
          <ToggleIconButton
            active={feedOpen}
            onClick={onToggleFeed}
            icon={<Rss className="h-4 w-4" aria-hidden="true" />}
            visibleLabel="Feed"
            ariaLabel={
              feedOpen
                ? "Hide live hazard and survivor feed drawer"
                : "Show live hazard and survivor feed drawer"
            }
          />
        </div>
      </div>
    </motion.div>
  );
}

function HudChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "cyan" | "emerald";
}) {
  const toneClasses =
    tone === "cyan"
      ? "text-cyan-300 border-cyan-400/30 bg-cyan-400/10"
      : "text-emerald-300 border-emerald-400/30 bg-emerald-400/10";
  return (
    <div className={`rounded-full border px-3 py-1.5 font-mono text-xs backdrop-blur ${toneClasses}`}>
      <span className="mr-1.5 hidden text-[10px] uppercase tracking-widest opacity-70 sm:inline">
        {label}
      </span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function ToggleIconButton({
  active,
  onClick,
  icon,
  visibleLabel,
  ariaLabel,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  visibleLabel: string;
  ariaLabel: string;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.96 }}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide backdrop-blur transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 ${
        active
          ? "border-cyan-400/50 bg-cyan-400/15 text-cyan-200"
          : "border-white/10 bg-black/30 text-zinc-400 hover:border-white/20 hover:text-zinc-200"
      }`}
    >
      {icon}
      <span className="hidden sm:inline">{visibleLabel}</span>
    </motion.button>
  );
}
