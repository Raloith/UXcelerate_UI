"use client";

/**
 * Left-side "Robot Fleet Status" drawer: one row per active rescue robot,
 * showing simulated battery / RSSI signal / current task / payload, plus
 * (recent addition) a live comms-link status (green/amber/red - see
 * commsDrop.ts) with a subtle "glitch" cue while disconnected, and an
 * Emergency Beacon dispatch control for queuing a canned command that
 * "executes" (logs a feed entry) once that robot's link reconnects.
 *
 * Purely presentational - all the numbers come from `TelemetryTracker` via
 * `DisasterMap3D`'s `onTelemetryUpdate`, throttled well below per-frame
 * rate before they ever reach this component's props. Queued-command state
 * lives one level up in page.tsx (it's operator/session state, not part of
 * the 3D telemetry pipeline).
 */

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertOctagon,
  BatteryLow,
  BatteryMedium,
  BatteryFull,
  Radio,
  Siren,
  X,
} from "lucide-react";
import {
  CANNED_COMMANDS,
  type QueuedCommand,
  type QueuedCommandKind,
  type RobotTelemetry,
  type CommsLinkState,
} from "@/components/disaster-map/telemetry";

export interface RobotFleetDrawerProps {
  open: boolean;
  onClose: () => void;
  robots: RobotTelemetry[];
  /** Pending Emergency Beacon command per robot, keyed by robot id - see page.tsx. */
  queuedCommands: Record<string, QueuedCommand | undefined>;
  onDispatchCommand: (robotId: string, kind: QueuedCommandKind) => void;
  onBroadcastCommand: (kind: QueuedCommandKind) => void;
}

const LINK_STATE_META: Record<
  CommsLinkState,
  { label: string; dotClass: string; textClass: string }
> = {
  green: { label: "LINK: NOMINAL", dotClass: "bg-emerald-400", textClass: "text-emerald-300" },
  amber: { label: "LINK: DEGRADED", dotClass: "bg-amber-400", textClass: "text-amber-300" },
  red: { label: "LINK: LOST", dotClass: "bg-rose-400", textClass: "text-rose-300" },
};

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

/** Small green/amber/red status pill - `aria-live` on the label so a link-state change (e.g. "LINK: LOST") is announced to screen readers as it happens. */
function LinkStatusBadge({ state }: { state: CommsLinkState }) {
  const meta = LINK_STATE_META[state];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/30 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${meta.textClass}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${meta.dotClass} ${state === "red" ? "animate-pulse" : ""}`}
        aria-hidden="true"
      />
      <span aria-live="polite">{meta.label}</span>
    </span>
  );
}

export default function RobotFleetDrawer({
  open,
  onClose,
  robots,
  queuedCommands,
  onDispatchCommand,
  onBroadcastCommand,
}: RobotFleetDrawerProps) {
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

            <div className="border-b border-white/10 px-3 py-2.5">
              <button
                type="button"
                onClick={() => onBroadcastCommand("RETURN_TO_BASE")}
                aria-label="Broadcast a return-to-base command to every disconnected unit"
                className="flex w-full items-center justify-center gap-1.5 rounded-md border border-rose-400/30 bg-rose-400/10 px-2 py-1.5 font-mono text-[10px] uppercase tracking-widest text-rose-200 transition-colors hover:border-rose-400/60 hover:bg-rose-400/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
              >
                <AlertOctagon className="h-3.5 w-3.5" aria-hidden="true" />
                Emergency Beacon &middot; Broadcast Return-to-Base
              </button>
            </div>

            <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
              {robots.length === 0 && (
                <p className="p-3 text-center font-mono text-[11px] text-zinc-500">
                  Awaiting telemetry&hellip;
                </p>
              )}
              {robots.map((robot) => (
                <RobotRow
                  key={robot.id}
                  robot={robot}
                  queuedCommand={queuedCommands[robot.id]}
                  onDispatchCommand={onDispatchCommand}
                  reduceMotion={Boolean(reduceMotion)}
                />
              ))}
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function RobotRow({
  robot,
  queuedCommand,
  onDispatchCommand,
  reduceMotion,
}: {
  robot: RobotTelemetry;
  queuedCommand: QueuedCommand | undefined;
  onDispatchCommand: (robotId: string, kind: QueuedCommandKind) => void;
  reduceMotion: boolean;
}) {
  const [commandChoice, setCommandChoice] = useState<QueuedCommandKind>(CANNED_COMMANDS[0].kind);
  const isRed = robot.commsState === "red";
  const isAmber = robot.commsState === "amber";
  const canDispatch = robot.commsState !== "green" && !queuedCommand;

  return (
    <motion.div
      style={{ borderLeftColor: robot.color }}
      className="relative overflow-hidden rounded-lg border border-l-[3px] border-white/10 bg-white/5 p-3"
      animate={
        isRed && !reduceMotion
          ? { x: [0, -1.5, 1, -1, 0], opacity: [1, 0.55, 1, 0.75, 1] }
          : { x: 0, opacity: 1 }
      }
      transition={
        isRed && !reduceMotion
          ? { duration: 0.5, repeat: Infinity, repeatDelay: 2.2, ease: "easeInOut" }
          : { duration: 0.2 }
      }
    >
      {isRed && !reduceMotion && (
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-rose-500/0 via-rose-500/25 to-rose-500/0 mix-blend-overlay"
          animate={{ x: ["-120%", "120%"] }}
          transition={{ duration: 1.4, repeat: Infinity, repeatDelay: 2.6, ease: "linear" }}
        />
      )}
      {isAmber && (
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-amber-400/10"
          animate={reduceMotion ? undefined : { opacity: [0.25, 0.65, 0.25] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      <div className="relative">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="font-mono text-sm font-semibold" style={{ color: robot.color }}>
            {robot.label}
          </span>
          <span className="truncate rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-zinc-400">
            {robot.payload}
          </span>
        </div>

        <div className="mb-1.5">
          <LinkStatusBadge state={robot.commsState} />
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
        <p className="mb-1 flex items-center gap-1 font-mono text-[11px] text-violet-300/90">
          <Radio className="h-3 w-3" aria-hidden="true" />
          <span className="text-zinc-500">Channel:&nbsp;</span>
          {robot.channelLabel} &middot; {robot.channelFrequencyMHz.toFixed(2)} MHz
        </p>
        <p className="mb-2 text-[11px] text-zinc-300">
          <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            Task:{" "}
          </span>
          {robot.task}
        </p>

        {queuedCommand ? (
          <div className="flex items-center gap-1.5 rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1.5 font-mono text-[10px] uppercase tracking-widest text-amber-200">
            <Siren className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span aria-live="polite">
              PENDING: {queuedCommand.label} &middot; executes on reconnect
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <select
              value={commandChoice}
              onChange={(e) => setCommandChoice(e.target.value as QueuedCommandKind)}
              aria-label={`Select emergency command for ${robot.label}`}
              disabled={!canDispatch}
              className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/40 px-1.5 py-1 font-mono text-[10px] uppercase tracking-wide text-zinc-300 disabled:opacity-40"
            >
              {CANNED_COMMANDS.map((c) => (
                <option key={c.kind} value={c.kind}>
                  {c.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => onDispatchCommand(robot.id, commandChoice)}
              disabled={!canDispatch}
              aria-label={
                canDispatch
                  ? `Queue ${CANNED_COMMANDS.find((c) => c.kind === commandChoice)?.label} for ${robot.label}`
                  : `Link nominal for ${robot.label} — no dispatch needed`
              }
              title={canDispatch ? "Dispatch to this unit" : "Link nominal — no dispatch needed"}
              className={`flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-widest transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 ${
                canDispatch
                  ? "border-rose-400/40 bg-rose-400/10 text-rose-200 hover:border-rose-400/70 hover:bg-rose-400/20"
                  : "cursor-not-allowed border-white/10 bg-black/30 text-zinc-600"
              }`}
            >
              <Siren className="h-3 w-3" aria-hidden="true" />
              Dispatch
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
