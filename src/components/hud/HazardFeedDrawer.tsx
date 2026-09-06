"use client";

/**
 * Right-side "Live Hazard & Survivor Feed" drawer: a capped, newest-first
 * scrolling log of reveal events (see TelemetryTracker.tsx for the
 * detection pass). Newest-first means new entries appear right at the top
 * of the (already top-anchored) list, so there's nothing extra to
 * "auto-scroll" - the reader never has to chase new entries down the page.
 */

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertTriangle, Blocks, HeartPulse, X } from "lucide-react";
import type { FeedEntry, FeedKind, FeedSeverity } from "@/components/disaster-map/telemetry";
import { formatElapsedClock } from "./format";

export interface HazardFeedDrawerProps {
  open: boolean;
  onClose: () => void;
  entries: FeedEntry[];
}

const SEVERITY_STYLES: Record<FeedSeverity, string> = {
  info: "border-l-emerald-400 text-emerald-200",
  warning: "border-l-amber-400 text-amber-200",
  critical: "border-l-rose-400 text-rose-200",
};

function KindIcon({ kind }: { kind: FeedKind }) {
  const className = "h-3.5 w-3.5";
  if (kind === "survivor") return <HeartPulse className={className} aria-hidden="true" />;
  if (kind === "hazard") return <AlertTriangle className={className} aria-hidden="true" />;
  return <Blocks className={className} aria-hidden="true" />;
}

export default function HazardFeedDrawer({ open, onClose, entries }: HazardFeedDrawerProps) {
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ x: "100%", opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "100%", opacity: 0 }}
          transition={
            reduceMotion ? { duration: 0.15 } : { type: "spring", stiffness: 260, damping: 28 }
          }
          aria-label="Live hazard and survivor feed"
          className="pointer-events-auto absolute bottom-24 right-0 top-20 z-20 w-[21rem] overflow-hidden rounded-l-2xl border border-r-0 border-white/10 bg-black/70 shadow-2xl shadow-black/50 backdrop-blur-md sm:top-24"
        >
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <h2 className="font-mono text-xs uppercase tracking-widest text-cyan-300/80">
                Live Hazard &amp; Survivor Feed
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close live feed drawer"
                className="rounded-md p-1 text-zinc-500 transition-colors hover:text-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              {entries.length === 0 && (
                <p className="p-3 text-center font-mono text-[11px] text-zinc-500">
                  No detections yet &mdash; scanning sector&hellip;
                </p>
              )}
              <ul className="space-y-2">
                <AnimatePresence initial={false}>
                  {entries.map((entry) => (
                    <motion.li
                      key={entry.id}
                      layout
                      initial={{ opacity: 0, x: 28 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      transition={
                        reduceMotion
                          ? { duration: 0.1 }
                          : { type: "spring", stiffness: 340, damping: 30 }
                      }
                      className={`rounded-md border-l-2 bg-white/5 p-2.5 font-mono text-[11px] leading-snug ${SEVERITY_STYLES[entry.severity]}`}
                    >
                      <div className="mb-1 flex items-center gap-1.5 text-zinc-400">
                        <KindIcon kind={entry.kind} />
                        <span>[{formatElapsedClock(entry.timestampSeconds)}]</span>
                        <span className="text-zinc-300">{entry.robotLabel}</span>
                      </div>
                      <p className="font-semibold">{entry.title}</p>
                      <p className="text-zinc-300">{entry.detail}</p>
                      <p className="text-violet-300/80">
                        Broadcasting to fleet on {entry.channelLabel}
                      </p>
                      <p className="text-zinc-500">
                        ({entry.position[0]}, {entry.position[1]})
                      </p>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
