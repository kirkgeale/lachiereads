// Math-side analogue of decodable.ts: given the learner's reached skills,
// derive the numeric range and operations they can safely be asked about,
// and validate proposed items against that envelope.
//
// The AI proposes operands + operation only; the app COMPUTES the answer.
// This helper is what actually enforces "no untaught operation, no operand or
// answer outside range" — the model's numeric answer is never trusted.

export type MathOp = "+" | "-";

export interface ReachedSkillLite {
  code: string;
  strand: string;
  max_value: number;
}

export interface Envelope {
  maxNumber: number;
  allowedOps: MathOp[];
  wordProblemsUnlocked: boolean;
}

export function deriveEnvelope(reached: ReachedSkillLite[]): Envelope {
  let maxNumber = 0;
  let hasAdd = false;
  let hasSub = false;
  let hasWord = false;
  for (const s of reached) {
    if (s.max_value > maxNumber) maxNumber = s.max_value;
    if (s.strand === "addition") hasAdd = true;
    if (s.strand === "subtraction") hasSub = true;
    if (s.strand === "word_problems") hasWord = true;
  }
  const allowedOps: MathOp[] = [];
  if (hasAdd) allowedOps.push("+");
  if (hasSub) allowedOps.push("-");
  return { maxNumber, allowedOps, wordProblemsUnlocked: hasWord && allowedOps.length > 0 };
}

export interface MathFactItem {
  a: number;
  op: MathOp;
  b: number;
}

export interface WordProblemItem extends MathFactItem {
  text: string;
}

export function compute(a: number, op: MathOp, b: number): number {
  return op === "+" ? a + b : a - b;
}

export interface ValidationResult {
  ok: boolean;
  offenders: string[];
}

export function validateMathItems(
  items: MathFactItem[],
  maxNumber: number,
  allowedOps: MathOp[],
): ValidationResult {
  const offenders: string[] = [];
  const allowed = new Set(allowedOps);
  for (const it of items) {
    if (!Number.isInteger(it.a) || !Number.isInteger(it.b)) {
      offenders.push(`${it.a}${it.op}${it.b}: non-integer`);
      continue;
    }
    if (!allowed.has(it.op)) {
      offenders.push(`${it.a}${it.op}${it.b}: op not allowed`);
      continue;
    }
    const ans = compute(it.a, it.op, it.b);
    if (it.a < 0 || it.a > maxNumber || it.b < 0 || it.b > maxNumber) {
      offenders.push(`${it.a}${it.op}${it.b}: operand out of range`);
      continue;
    }
    if (ans < 0 || ans > maxNumber) {
      offenders.push(`${it.a}${it.op}${it.b}=${ans}: answer out of range`);
      continue;
    }
  }
  return { ok: offenders.length === 0, offenders };
}

// Deterministic fallback fact generator: produces up to `count` valid facts
// within (maxNumber, allowedOps). Prefers small numbers first.
export function fallbackFacts(maxNumber: number, allowedOps: MathOp[], count = 6): MathFactItem[] {
  const facts: MathFactItem[] = [];
  if (allowedOps.length === 0 || maxNumber <= 0) return facts;
  const ops = [...allowedOps];
  outer: for (let sum = 2; sum <= maxNumber; sum++) {
    for (let a = 0; a <= sum; a++) {
      const b = sum - a;
      for (const op of ops) {
        const first = op === "+" ? a : sum;
        const second = op === "+" ? b : a;
        // for '-' choose a - b form where a>=b and a<=maxNumber
        if (op === "-" && (first < second || first > maxNumber)) continue;
        const ans = compute(first, op, second);
        if (ans < 0 || ans > maxNumber) continue;
        // avoid dup
        if (facts.some((f) => f.a === first && f.b === second && f.op === op)) continue;
        facts.push({ a: first, op, b: second });
        if (facts.length >= count) break outer;
      }
    }
  }
  return facts;
}
