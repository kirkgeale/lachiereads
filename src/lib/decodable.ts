// Tokenises a word into an ordered list of graphemes drawn from the allowed set.
// Returns null if the word cannot be tokenised (i.e. is not decodable with those graphemes).
// Prefers longer graphemes (e.g. "igh" over "i") via greedy longest-match.

export function tokenise(word: string, allowedGraphemes: string[]): string[] | null {
  const w = word.toLowerCase().replace(/[^a-z_]/g, "");
  if (!w) return null;
  // Split into split-digraph vs regular graphemes; split digraphs match VCe patterns
  const singles = allowedGraphemes.filter((g) => !g.includes("_")).sort((a, b) => b.length - a.length);
  const splits = allowedGraphemes.filter((g) => g.includes("_"));

  // Try split-digraph consumption at each position: for a_e match VCe where V=a, C=any consonant, e is silent
  const consume = (i: number): string[] | null => {
    if (i >= w.length) return [];
    // Try split digraphs first
    for (const sd of splits) {
      const [v, ] = sd.split("_");
      if (w[i] === v && w[i + 2] === "e" && /[a-z]/.test(w[i + 1] ?? "")) {
        // consume V + C + e as [split, C]  -> represent as sd token
        const rest = consume(i + 3);
        if (rest !== null) return [sd, w[i + 1]!, ...rest];
      }
    }
    for (const g of singles) {
      if (w.startsWith(g, i)) {
        const rest = consume(i + g.length);
        if (rest !== null) return [g, ...rest];
      }
    }
    return null;
  };
  return consume(0);
}

export function isDecodable(word: string, allowedGraphemes: string[], knownHeartWords: string[]): boolean {
  const clean = word.toLowerCase().replace(/[^a-z]/g, "");
  if (knownHeartWords.map((h) => h.toLowerCase()).includes(clean)) return true;
  return tokenise(clean, allowedGraphemes) !== null;
}

export function extractWords(text: string): string[] {
  return text
    .split(/[^A-Za-z']+/)
    .map((w) => w.replace(/'/g, ""))
    .filter(Boolean);
}

export function validateContent(
  words: string[],
  allowedGraphemes: string[],
  knownHeartWords: string[],
): { ok: boolean; offenders: string[] } {
  const offenders = words.filter((w) => !isDecodable(w, allowedGraphemes, knownHeartWords));
  return { ok: offenders.length === 0, offenders };
}
