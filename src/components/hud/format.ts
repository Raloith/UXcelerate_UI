/** Shared formatting helpers for the mission HUD - kept tiny and pure so both the clock and the feed log timestamps always agree on one format. */

/** Seconds -> `T+HH:MM:SS`, the mission-clock convention used across the HUD. */
export function formatElapsedClock(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? totalSeconds : 0;
  const s = Math.max(0, Math.floor(safe));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `T+${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}
