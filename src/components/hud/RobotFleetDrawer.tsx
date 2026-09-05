"use client";

/**
 * Left-side "Robot Fleet Status" drawer: one row per active rescue robot,
 * showing simulated battery / RSSI signal / current task / payload. Purely
 * presentational - all the numbers come from `TelemetryTracker` via
 * `DisasterMap3D`'s `onTelemetryUpdate`, throttled well below per-frame
 * rate before they ever reach this component's props.
 */

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BatteryLow, BatteryMedium, BatteryFull, X } from "lucide-react";
import type { RobotTelemetry } from "@/components/disaster-map/telemetry";

export interface RobotFleetDrawerProps {
  open: boolean;
  onClose: () => void;
  robots: RobotTelemetry[];
}

function batteryBarTone(percent: number): string {
  if (percent > 55) return "bg-emerald-400";
  if (percent > 25) return "bg-amber-400";
  return "bg-rose-400";
}

function BatteryIcon({ percent }: { percent: number }) {
  const className = "h-3.5 w-3.5";
  if (percent > 55) return <BatteryFull className={className} aria-hidden="true" />;
  if (percent > 25) return <BatteryMedium className={className} aria-hidden="true" />;
  return <BatteryLow className={className} aria-hidden="true" />;
}

export default function RobotFleetDrawer({ open, onClose, robots }: RobotFleetDrawerProps) {
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ x: "-100%", opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "-100%", opacity: 0 }}
          transition={
            reduceMotion ? { duration: 0.15 } : { type: "spring", stiffness: 260, damping: 28 }
          }
          aria-label="Robot fleet status"
          className="pointer-events-auto absolute bottom-24 left-0 top-20 z-20 w-[19.5rem] overflow-hidden rounded-r-2xl border border-l-0 border-white/10 bg-black/70 shadow-2xl shadow-black/50 backdrop-blur-md sm:top-24"
        >
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <h2 className="font-mono text-xs uppercase tracking-widest text-cyan-300/80">
                Robot Fleet Status
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close robot fleet status drawer"
                className="rounded-md p-1 text-zinc-500 transition-colors hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
              {robots.length === 0 && (
                <p className="p-3 text-center font-mono text-[11px] text-zinc-500">
                  Awaiting telemetry&hellip;
                </p>
              )}
              {robots.map((robot) => (
                <div
                  key={robot.id}
                  style={{ borderLeftColor: robot.color }}
                  className="rounded-lg border border-l-[3px] border-white/10 bg-white/5 p-3"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-semibold" style={{ color: robot.color }}>
                      {robot.label}
                    </span>
                    <span className="truncate rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-zinc-400">
                      {robot.payload}
                    </span>
                  </div>

                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="flex w-16 shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                      <BatteryIcon percent={robot.batteryPercent} />
                      Battery
                    </span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                      <motion.div
                        className={`h-full rounded-full ${batteryBarTone(robot.batteryPercent)}`}
                        initial={false}
                        animate={{ width: `${robot.batteryPercent}%` }}
                        transition={{ type: "spring", stiffness: 120, damping: 20 }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right font-mono text-[11px] text-zinc-300">
                      {robot.batteryPercent}%
                    </span>
                  </div>

                  <p className="mb-1 font-mono text-[11px] text-zinc-400">
                    <span className="text-zinc-500">SIGNAL&nbsp;</span>
                    {robot.rssiDbm} dBm
                  </p>
                  <p className="text-[11px] text-zinc-300">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                      Task:{" "}
                    </span>
                    {robot.task}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
