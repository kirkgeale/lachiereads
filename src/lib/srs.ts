import type { ItemStatus, Outcome } from "./types";

// Leitner intervals in days indexed by box number (1..5)
const INTERVALS: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16 };

export interface SrsInput {
  box: number;
  streak: number;
  outcome: Outcome;
}

export interface SrsResult {
  box: number;
  streak: number;
  status: ItemStatus;
  next_due_date: string; // ISO date (YYYY-MM-DD)
  last_seen: string; // ISO timestamp
}

function addDaysISO(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function deriveStatus(box: number, streak: number): ItemStatus {
  if (box <= 2) return "learning";
  if (box === 3) return "practising";
  return streak > 0 ? "secure" : "practising";
}

export function applyOutcome({ box, streak, outcome }: SrsInput): SrsResult {
  let newBox = box;
  let newStreak = streak;
  if (outcome === "got_it") {
    // Clean first-try — promote and grow streak
    newBox = Math.min(5, box + 1);
    newStreak = streak + 1;
  } else if (outcome === "self_corrected") {
    // Retrieval eventually succeeded unaided — grow streak, promote only once cushion built
    newStreak = streak + 1;
    newBox = newStreak >= 3 ? Math.min(5, box + 1) : box;
  } else if (outcome === "prompted") {
    // Needed a cue — hold in place, reset streak, but do not demote
    newBox = box;
    newStreak = 0;
  } else {
    // missed — demote to learning
    newBox = 1;
    newStreak = 0;
  }
  const interval = INTERVALS[newBox] ?? 1;
  return {
    box: newBox,
    streak: newStreak,
    status: deriveStatus(newBox, newStreak),
    next_due_date: addDaysISO(interval),
    last_seen: new Date().toISOString(),
  };
}
