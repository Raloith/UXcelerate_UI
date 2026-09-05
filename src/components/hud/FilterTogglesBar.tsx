"use client";

/**
 * Bottom quick-filter pills: toggle the hazard markers / clear-route lines
 * / blocked-path rubble groups on and off in the 3D scene. Same accessible
 * toggle-button pattern as page.tsx's pre-existing "Sensor Radius" button
 * (visible `aria-pressed` state, focus-visible ring, frosted pill chrome).
 */

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { AlertTriangle, Blocks, Route as RouteIcon } from "lucide-react";

export interface FilterTogglesBarProps {
  showHazards: boolean;
  onToggleHazards: () => void;
  showRoutes: boolean;
  onToggleRoutes: () => void;
  showBlockedPaths: boolean;
  onToggleBlockedPaths: () => void;
}

export default function FilterTogglesBar({
  showHazards,
  onToggleHazards,
  showRoutes,
  onToggleRoutes,
  showBlockedPaths,
  onToggleBlockedPaths,
}: FilterTogglesBarProps) {
  return (
    <div className="pointer-events-auto flex flex-wrap gap-2">
      <FilterPill
        icon={<AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}
        label="Show Structural Hazards"
        active={showHazards}
        onToggle={onToggleHazards}
      />
      <FilterPill
        icon={<RouteIcon className="h-3.5 w-3.5" aria-hidden="true" />}
        label="Show Clear Routes"
        active={showRoutes}
        onToggle={onToggleRoutes}
      />
      <FilterPill
        icon={<Blocks className="h-3.5 w-3.5" aria-hidden="true" />}
        label="Show Blockades"
        active={showBlockedPaths}
        onToggle={onToggleBlockedPaths}
      />
    </div>
  );
}

function FilterPill({
  icon,
  label,
  active,
  onToggle,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      aria-label={`${label} (currently ${active ? "shown" : "hidden"})`}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide backdrop-blur transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 ${
        active
          ? "border-cyan-400/50 bg-cyan-400/15 text-cyan-200"
          : "border-white/10 bg-black/30 text-zinc-500 hover:border-white/20 hover:text-zinc-300"
      }`}
    >
      {icon}
      {label}
    </motion.button>
  );
}
