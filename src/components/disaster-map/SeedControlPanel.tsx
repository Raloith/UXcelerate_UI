"use client";

/**
 * Accessible seed controls for the disaster map.
 *
 * Two ways to change the map, both explained in plain language right under
 * the control that does it:
 *   1. "Regenerate" - picks a brand-new random seed for you.
 *   2. "Custom Seed" - type your own seed to deterministically rebuild the
 *      exact same map every time (useful for sharing a specific layout).
 *
 * Accessibility notes:
 * - Every control has a visible label and a permanent (not hover-only)
 *   description, so keyboard and screen-reader users get the same
 *   explanation as sighted mouse users.
 * - `aria-describedby` links each control to its description / error text.
 * - Validation errors use `role="alert"` so they're announced immediately.
 * - A polite live region announces the outcome after every regenerate/apply,
 *   since the visual map change alone isn't perceivable to screen readers.
 * - All interactive elements have visible `focus-visible` rings for keyboard
 *   navigation and meet a 44px-ish minimum tap target on mobile.
 */

import { useCallback, useId, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { CircleAlert, CircleCheck, Dices } from "lucide-react";

const SEED_WORDS = ["QUAKE", "SECTOR", "TREMOR", "FAULT", "RUBBLE", "SIGNAL", "GRID"];

/** Not used during 3D generation - only to suggest a fresh seed in the UI. */
function randomSeedSuggestion(): string {
  const word = SEED_WORDS[Math.floor(Math.random() * SEED_WORDS.length)];
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `${word}-${digits}`;
}

export interface SeedControlPanelProps {
  /** The seed currently driving the rendered map. */
  currentSeed: string;
  /** Called with a new seed string whenever the user regenerates or applies one. */
  onApplySeed: (seed: string) => void;
  className?: string;
}

export default function SeedControlPanel({
  currentSeed,
  onApplySeed,
  className,
}: SeedControlPanelProps) {
  const [draft, setDraft] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [spinKey, setSpinKey] = useState(0);

  const inputId = useId();
  const regenDescId = useId();
  const customDescId = useId();
  const errorId = useId();

  const applySeed = useCallback(
    (rawSeed: string, source: "regenerate" | "custom") => {
      const trimmed = rawSeed.trim();
      if (!trimmed) {
        setError("Enter a seed before applying \u2014 it can't be blank.");
        return;
      }
      if (trimmed.length > 40) {
        setError("Keep seeds under 40 characters.");
        return;
      }
      setError(null);
      onApplySeed(trimmed);
      setStatus(
        source === "regenerate"
          ? `Regenerated the site with a new random seed: ${trimmed}.`
          : `Applied custom seed "${trimmed}". Map rebuilt deterministically.`
      );
      if (source === "custom") setDraft("");
    },
    [onApplySeed]
  );

  const handleRegenerate = () => {
    setSpinKey((k) => k + 1);
    applySeed(randomSeedSuggestion(), "regenerate");
  };

  const handleApplyCustom = () => applySeed(draft, "custom");

  return (
    <motion.section
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.15, ease: "easeOut" }}
      aria-label="Map seed controls"
      className={`pointer-events-auto w-[19.5rem] rounded-lg border border-white/10 bg-black/75 p-4 font-mono text-xs backdrop-blur-md shadow-lg shadow-black/40 ${className ?? ""}`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="uppercase tracking-widest text-cyan-300/80">Seed Control</h2>
        <span
          className="max-w-[9.5rem] truncate rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-zinc-300"
          title={`Active seed currently driving this map: ${currentSeed}`}
        >
          ACTIVE: {currentSeed}
        </span>
      </div>

      {/* --- Option 1: Regenerate with a fresh random seed --- */}
      <div className="mb-4">
        <motion.button
          type="button"
          onClick={handleRegenerate}
          aria-describedby={regenDescId}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          className="flex min-h-[2.5rem] w-full items-center justify-center gap-2 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 font-semibold text-cyan-200 transition-colors hover:bg-cyan-400/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
        >
          <motion.span
            key={spinKey}
            initial={{ rotate: 0 }}
            animate={{ rotate: 360 }}
            transition={{ duration: 0.6, ease: "easeInOut" }}
            className="inline-flex"
          >
            <Dices className="h-4 w-4" aria-hidden="true" />
          </motion.span>
          Regenerate Map
        </motion.button>
        <p id={regenDescId} className="mt-1.5 text-[11px] leading-snug text-zinc-400">
          Picks a brand-new random seed and rebuilds everything from
          scratch{"\u00a0\u2014\u00a0"}terrain, rubble, hazards, routes and
          survivor positions.
        </p>
      </div>

      <div className="mb-3 h-px bg-white/10" aria-hidden="true" />

      {/* --- Option 2: Type your own seed --- */}
      <div>
        <label htmlFor={inputId} className="mb-1 block font-semibold text-zinc-200">
          Custom Seed
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              id={inputId}
              type="text"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                if (error) setError(null);
              }}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleApplyCustom();
                }
              }}
              placeholder="e.g. SECTOR-9"
              aria-describedby={error ? `${customDescId} ${errorId}` : customDescId}
              aria-invalid={error ? true : undefined}
              className="min-h-[2.5rem] w-full rounded-md border border-white/15 bg-white/5 px-2.5 py-2 text-zinc-100 outline-none placeholder:text-zinc-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
            />
            {/* Spring-animated focus indicator (Motion.dev), echoes the
                Skiper UI "smooth caret" input pattern without native caret
                replacement, which would fight browser text-selection a11y. */}
            <motion.span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-2 bottom-0 h-[2px] origin-left rounded-full bg-cyan-300"
              initial={false}
              animate={{ scaleX: inputFocused ? 1 : 0, opacity: inputFocused ? 1 : 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 26 }}
            />
          </div>
          <motion.button
            type="button"
            onClick={handleApplyCustom}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            className="flex min-h-[2.5rem] items-center gap-1.5 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-3 font-semibold text-emerald-200 transition-colors hover:bg-emerald-400/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
          >
            <CircleCheck className="h-4 w-4" aria-hidden="true" />
            Apply
          </motion.button>
        </div>
        <p id={customDescId} className="mt-1.5 text-[11px] leading-snug text-zinc-400">
          Type any word or code, then press Apply (or Enter). The same seed
          always rebuilds the identical map, so a squad can compare notes on
          one exact layout.
        </p>
        <AnimatePresence>
          {error && (
            <motion.p
              id={errorId}
              role="alert"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="mt-1.5 flex items-center gap-1.5 text-[11px] text-rose-300"
            >
              <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />
              {error}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* Screen-reader-only status announcement (not shown visually, since
          the visible "ACTIVE" chip above already covers sighted users). */}
      <span role="status" aria-live="polite" className="sr-only">
        {status}
      </span>
    </motion.section>
  );
}
