"use client";

/**
 * Short-lived toast stack confirming an Emergency Beacon dispatch (queued
 * or broadcast) - same frosted-glass/monospace chrome as the rest of the
 * HUD. Purely presentational: page.tsx owns the toast list (push + a
 * `setTimeout`-scheduled removal, both from event-handler code, never
 * render) and passes it straight through here.
 */

import { AnimatePresence, motion } from "motion/react";
import { Radio } from "lucide-react";

export interface CommandToast {
  id: string;
  message: string;
}

export interface CommandToastsProps {
  toasts: CommandToast[];
}

export default function CommandToasts({ toasts }: CommandToastsProps) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute bottom-24 left-1/2 z-40 flex w-full max-w-md -translate-x-1/2 flex-col items-center gap-2 px-4"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="flex items-center gap-2 rounded-full border border-cyan-400/30 bg-black/80 px-4 py-2 font-mono text-[11px] text-cyan-100 shadow-lg shadow-black/50 backdrop-blur-md"
          >
            <Radio className="h-3.5 w-3.5 shrink-0 text-cyan-300" aria-hidden="true" />
            <span>{toast.message}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
